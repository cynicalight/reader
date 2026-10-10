export function devIsolation({
  isPackaged,
  env,
}: {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
}) {
  return {
    userDataDirectory: isPackaged ? null : "Reader Dev",
    registerProtocol: isPackaged || env.READER_DEV_PROTOCOL === "1",
    enableConnector: isPackaged || env.READER_DEV_CONNECTOR === "1",
  };
}
