import codex from "@lobehub/icons-static-svg/icons/codex.svg";
import claude from "@lobehub/icons-static-svg/icons/claudecode.svg";
import kimi from "@lobehub/icons-static-svg/icons/kimi.svg";

const providers = {
  codex: { icon: codex, label: "Codex" },
  claude: { icon: claude, label: "Claude Code" },
  kimi: { icon: kimi, label: "Kimi Code" },
};

export function ProviderIdentity({ provider }: { provider: string }) {
  const brand = providers[provider as keyof typeof providers];
  if (!brand) return <span>{provider}</span>;
  return (
    <span className="provider-identity">
      <span
        aria-hidden="true"
        className="provider-icon"
        style={{
          maskImage: `url("${brand.icon}")`,
          WebkitMaskImage: `url("${brand.icon}")`,
        }}
      />
      <span>{brand.label}</span>
    </span>
  );
}
