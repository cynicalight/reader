import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readWindowsProxySettings } from "./windows-proxy";

const execFileAsync = promisify(execFile);
// Use the native dictionary, not scutil's human-readable output. This does not
// send Apple Events to other applications or read shell/credential files.
const proxyScript = `ObjC.import("SystemConfiguration");
JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.SCDynamicStoreCopyProxies(null))));`;

export function systemProxyEnvironment(
  inherited: NodeJS.ProcessEnv,
  settings: unknown,
): NodeJS.ProcessEnv {
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("系统代理返回了无效配置");
  const config = settings as Record<string, unknown>;
  if (config.ProxyAutoConfigEnable || config.ProxyAutoDiscoveryEnable)
    throw new Error("暂不支持将 PAC 或自动发现代理传递给 Agent CLI");
  const env = { ...inherited };
  for (const key of Object.keys(env))
    if (/^(http|https|all|no)_proxy$/i.test(key)) delete env[key];
  env.NO_PROXY = env.no_proxy = "localhost,127.0.0.1,::1";
  // Disabled proxy settings may still retain old hosts and exception rules.
  if (!config.HTTPEnable && !config.HTTPSEnable && !config.SOCKSEnable)
    return env;
  if (config.ExcludeSimpleHostnames)
    throw new Error("暂不支持将简单主机名直连规则传递给 Agent CLI");

  for (const [kind, variable, scheme] of [
    ["HTTP", "HTTP_PROXY", "http"],
    ["HTTPS", "HTTPS_PROXY", "http"],
    ["SOCKS", "ALL_PROXY", "socks5"],
  ] as const) {
    if (!config[`${kind}Enable`]) continue;
    const host = config[`${kind}Proxy`];
    const port = config[`${kind}Port`];
    if (
      typeof host !== "string" ||
      !host ||
      /[\s/@?#]/.test(host) ||
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error(`${kind} 系统代理地址无效`);
    const authority =
      host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    const address = new URL(`${scheme}://${authority}:${port}`).href.replace(
      /\/$/,
      "",
    );
    env[variable] = env[variable.toLowerCase()] = address;
  }
  const exceptions = config.ExceptionsList ?? [];
  if (
    !Array.isArray(exceptions) ||
    exceptions.some((v) => typeof v !== "string")
  )
    throw new Error("系统代理直连例外无效");
  const bypass = new Set(["localhost", "127.0.0.1", "::1"]);
  for (const entry of exceptions as string[]) {
    const value = entry.trim().replace(/^\*\./, ".");
    if (!value) continue;
    if (/[\s,*]/.test(value)) throw new Error("系统代理包含不支持的直连例外");
    bypass.add(value);
  }
  env.NO_PROXY = env.no_proxy = [...bypass].join(",");
  return env;
}

export async function childProxyEnvironment(
  inherited: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<NodeJS.ProcessEnv> {
  if (platform === "win32")
    return systemProxyEnvironment(
      inherited,
      await readWindowsProxySettings(inherited),
    );
  if (platform !== "darwin") return { ...inherited };
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", proxyScript],
    { timeout: 5000, maxBuffer: 256 * 1024 },
  );
  return systemProxyEnvironment(inherited, JSON.parse(stdout));
}
