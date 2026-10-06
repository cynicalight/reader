import { beforeEach, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = Object.assign(() => {}, { [promisify.custom]: execute });
  return { execFile };
});
import { childProxyEnvironment } from "./proxy";

beforeEach(() => execute.mockReset());

it("reads Windows settings with hidden, bounded PowerShell and passes them to the child", async () => {
  execute.mockResolvedValue({
    stdout: '\uFEFF{"proxy":"127.0.0.1:7890","bypass":null}',
    stderr: "",
  });
  const result = await childProxyEnvironment(
    { SystemRoot: "D:\\Windows", Http_Proxy: "http://old:80" },
    "win32",
  );
  expect(result.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
  expect(result.Http_Proxy).toBeUndefined();
  const [file, args, options] = execute.mock.calls[0];
  expect(file).toBe(
    "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  expect(options).toMatchObject({ windowsHide: true, timeout: 10000 });
  expect(args).toContain("-NoProfile");
  expect(args).toContain("-NonInteractive");
  const source = Buffer.from(args[args.length - 1], "base64").toString(
    "utf16le",
  );
  expect(source).toContain("WinHttpGetIEProxyConfigForCurrentUser");
  expect(source).toContain("GlobalFree");
});

it("does not disguise a failed Windows configuration read as no proxy", async () => {
  execute.mockRejectedValue(new Error("PowerShell unavailable"));
  await expect(childProxyEnvironment({}, "win32")).rejects.toThrow(
    "PowerShell unavailable",
  );
});

it("does not launch a proxy reader on unsupported platforms", async () => {
  expect(
    await childProxyEnvironment({ HTTP_PROXY: "http://existing:80" }, "linux"),
  ).toEqual({ HTTP_PROXY: "http://existing:80" });
  expect(execute).not.toHaveBeenCalled();
});
