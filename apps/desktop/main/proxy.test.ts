import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { systemProxyEnvironment, childProxyEnvironment } from "./proxy";

describe("system proxy environment", () => {
  it("passes manual proxies to children without mutating the parent", () => {
    const parent = {
      PATH: "/bin",
      HTTPS_PROXY: "http://old:80",
      no_proxy: "*",
    };
    const env = systemProxyEnvironment(parent, {
      HTTPEnable: 1,
      HTTPProxy: "127.0.0.1",
      HTTPPort: 7890,
      HTTPSEnable: 1,
      HTTPSProxy: "127.0.0.1",
      HTTPSPort: 7891,
      SOCKSEnable: 1,
      SOCKSProxy: "127.0.0.1",
      SOCKSPort: 7892,
      ExceptionsList: ["*.local", "192.168.0.0/16", "localhost"],
    });
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.https_proxy).toBe("http://127.0.0.1:7891");
    expect(env.ALL_PROXY).toBe("socks5://127.0.0.1:7892");
    expect(env.all_proxy).toBe(env.ALL_PROXY);
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1,.local,192.168.0.0/16");
    expect(env.no_proxy).toBe(env.NO_PROXY);
    expect(env.PATH).toBe("/bin");
    expect(parent.HTTPS_PROXY).toBe("http://old:80");
    expect(parent.no_proxy).toBe("*");
  });

  it("clears inherited proxies when system proxies are off", () => {
    const parent = Object.fromEntries(
      ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"].flatMap((key) => [
        [key, "http://old:80"],
        [key.toLowerCase(), "http://old:80"],
      ]),
    );
    expect(systemProxyEnvironment(parent, {})).toEqual({
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
    });
  });

  it("supports IPv6 addresses", () => {
    expect(
      systemProxyEnvironment(
        {},
        {
          HTTPSEnable: 1,
          HTTPSProxy: "::1",
          HTTPSPort: 7890,
        },
      ).HTTPS_PROXY,
    ).toBe("http://[::1]:7890");
  });

  it("allows machines with no proxy configured to connect directly", () => {
    expect(systemProxyEnvironment({ PATH: "/bin" }, {})).toEqual({
      PATH: "/bin",
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
    });
    const disabled = systemProxyEnvironment(
      {},
      {
        HTTPEnable: 0,
        HTTPProxy: "old.invalid",
        HTTPPort: 7890,
        HTTPSEnable: 0,
        HTTPSProxy: "old.invalid",
        HTTPSPort: 7890,
        SOCKSEnable: 0,
        ProxyAutoConfigEnable: 0,
        ExcludeSimpleHostnames: 1,
        ExceptionsList: ["old*rule"],
      },
    );
    expect(disabled.HTTP_PROXY).toBeUndefined();
    expect(disabled.HTTPS_PROXY).toBeUndefined();
    expect(disabled.ALL_PROXY).toBeUndefined();
  });

  it.each([
    null,
    { ProxyAutoConfigEnable: 1 },
    { ProxyAutoDiscoveryEnable: 1 },
    { HTTPSEnable: 1, HTTPSProxy: "127.0.0.1", HTTPSPort: 0 },
    { HTTPSEnable: 1, HTTPSProxy: "user@host", HTTPSPort: 7890 },
    {
      HTTPEnable: 1,
      HTTPProxy: "localhost",
      HTTPPort: 7890,
      ExceptionsList: ["foo*bar"],
    },
  ])("rejects unreadable or unsupported configuration: %j", (settings) => {
    expect(() => systemProxyEnvironment({}, settings)).toThrow();
  });

  it("preserves other platforms' environment", async () => {
    const parent = { HTTPS_PROXY: "http://existing:7890" };
    expect(await childProxyEnvironment(parent, "win32")).toEqual(parent);
  });

  it("passes resolved proxies through the server process to its CLI child", () => {
    const env = systemProxyEnvironment(process.env, {
      HTTPSEnable: 1,
      HTTPSProxy: "127.0.0.1",
      HTTPSPort: 7890,
    });
    const server = `
      const { execFileSync } = require('node:child_process');
      process.stdout.write(execFileSync(process.execPath, ['-e',
        'console.log(JSON.stringify({proxy:process.env.HTTPS_PROXY,bypass:process.env.NO_PROXY}))'
      ]));
    `;
    const cli = JSON.parse(
      execFileSync(process.execPath, ["-e", server], {
        env,
        encoding: "utf8",
      }),
    );
    expect(cli.proxy).toBe("http://127.0.0.1:7890");
    expect(cli.bypass).toBe("localhost,127.0.0.1,::1");
  });
});
