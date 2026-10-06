export const releaseAPI =
  "https://api.github.com/repos/cynicalight/reader/releases/latest";
export const day = 24 * 60 * 60 * 1000;
export const retryDelay = 60 * 60 * 1000;

export interface UpdateState {
  lastChecked?: number;
  lastAttempt?: number;
}
export interface ReleaseUpdate {
  version: string;
  installer: string;
  downloadURL: string;
  checksumURL: string;
}
export type UpdateResult =
  | { status: "current" }
  | { status: "pending" }
  | { status: "available"; update: ReleaseUpdate };

function versionParts(value: string): bigint[] {
  const match =
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value,
    );
  if (!match) throw new Error("版本号格式无效");
  return match.slice(1, 4).map(BigInt);
}
export function newerRelease(candidate: string, installed: string): boolean {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  for (let i = 0; i < 3; i++) {
    if (next[i] !== current[i]) return next[i] > current[i];
  }
  // Only stable releases are offered. A stable version supersedes its prerelease.
  return installed.includes("-") && !candidate.includes("-");
}
export function checkDue(state: UpdateState, now: number): boolean {
  const elapsed = (timestamp: number | undefined, interval: number) =>
    timestamp === undefined || now < timestamp || now - timestamp >= interval;
  return (
    elapsed(state.lastChecked, day) && elapsed(state.lastAttempt, retryDelay)
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("GitHub 返回了无效的更新信息");
  return value as Record<string, unknown>;
}
export function selectRelease(
  value: unknown,
  installed: string,
  platform: string,
  arch: string,
): UpdateResult {
  const release = record(value);
  if (release.draft !== false || release.prerelease !== false)
    throw new Error("更新信息不是正式发布版本");
  if (typeof release.tag_name !== "string") throw new Error("缺少发布版本号");
  const tag = release.tag_name;
  // Stable channel; never offer pre-releases even if incorrectly marked on GitHub.
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("发布版本号格式无效");
  if (!newerRelease(tag, installed)) return { status: "current" };
  if (platform !== "darwin" || arch !== "arm64")
    throw new Error("当前平台没有官方更新安装包");
  const version = tag.slice(1);
  const installer = `Reader-${version}-mac-arm64.dmg`;
  if (!Array.isArray(release.assets)) throw new Error("缺少发布文件列表");
  const assets = release.assets.map(record);
  const assetURL = (name: string) => {
    const asset = assets.find(
      (item) => item.name === name && item.state === "uploaded",
    );
    if (!asset) return undefined;
    const expected = `https://github.com/cynicalight/reader/releases/download/${tag}/${name}`;
    if (asset.browser_download_url !== expected)
      throw new Error("更新文件地址与官方仓库不符");
    return expected;
  };
  const downloadURL = assetURL(installer);
  const checksumURL = assetURL("SHA256SUMS.txt");
  // Release is published before CI attaches the installers. Retry later.
  if (!downloadURL || !checksumURL) return { status: "pending" };
  return {
    status: "available",
    update: { version, installer, downloadURL, checksumURL },
  };
}

export function installerChecksum(text: string, filename: string): string {
  const matches = text.split(/\r?\n/).flatMap((line) => {
    const match = /^([a-fA-F0-9]{64}) {2}(.+)$/.exec(line);
    return match?.[2] === filename ? [match[1].toLowerCase()] : [];
  });
  if (matches.length !== 1) throw new Error("安装包校验值缺失或重复");
  return matches[0];
}

export class DailyUpdateChecker {
  private running?: Promise<UpdateResult>;
  constructor(
    private readonly options: {
      version: string;
      platform: string;
      arch: string;
      state: UpdateState;
      fetch: (url: string, init: RequestInit) => Promise<Response>;
      save: (state: UpdateState) => Promise<void>;
      now?: () => number;
    },
  ) {}
  isDue(): boolean {
    return checkDue(this.options.state, this.options.now?.() ?? Date.now());
  }
  check(): Promise<UpdateResult> {
    if (this.running) return this.running;
    this.running = this.perform().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async perform(): Promise<UpdateResult> {
    const { state, fetch: request, save } = this.options;
    const now = this.options.now?.() ?? Date.now();
    state.lastAttempt = now;
    await save({ ...state });
    const response = await request(releaseAPI, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      credentials: "omit",
    });
    let result: UpdateResult;
    if (response.status === 404) result = { status: "current" };
    else {
      if (!response.ok)
        throw new Error(`GitHub 更新检查失败 (${response.status})`);
      result = selectRelease(
        await response.json(),
        this.options.version,
        this.options.platform,
        this.options.arch,
      );
    }
    if (result.status !== "pending") {
      state.lastChecked = now;
      await save({ ...state });
    }
    return result;
  }
}
