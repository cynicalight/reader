import { Claude, Kimi, OpenAI } from "@lobehub/icons";

const providers = {
  codex: { Icon: OpenAI, Avatar: OpenAI.Avatar, label: "Codex" },
  claude: { Icon: Claude, Avatar: Claude.Avatar, label: "Claude Code" },
  kimi: { Icon: Kimi, Avatar: Kimi.Avatar, label: "Kimi Code" },
};

export function ProviderGlyph({
  provider,
  size = 24,
}: {
  provider: string;
  size?: number;
}) {
  const brand = providers[provider as keyof typeof providers];
  return brand ? <brand.Icon size={size} /> : null;
}

export function ProviderIcon({
  provider,
  size = 20,
}: {
  provider: string;
  size?: number;
}) {
  const brand = providers[provider as keyof typeof providers];
  if (!brand) return null;
  return (
    <span aria-hidden="true" className="provider-icon inline-flex shrink-0">
      <brand.Avatar size={size} iconClassName="size-full" />
    </span>
  );
}

export function ProviderIdentity({
  provider,
  size = 20,
}: {
  provider: string;
  size?: number;
}) {
  const brand = providers[provider as keyof typeof providers];
  if (!brand) return <span>{provider}</span>;
  return (
    <span className="provider-identity">
      <ProviderIcon provider={provider} size={size} />
      <span>{brand.label}</span>
    </span>
  );
}
