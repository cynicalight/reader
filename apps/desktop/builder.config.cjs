module.exports = {
  appId: "io.github.cynicalight.reader",
  productName: "Reader",
  directories: { output: "../../release" },
  files: ["dist/**/*", "package.json"],
  extraResources: [{ from: "staging", to: ".", filter: ["**/*"] }],
  asar: true,
  npmRebuild: false,
  publish: null,
  mac: {
    // The zip is the Squirrel.Mac in-place update payload.
    target: ["dmg", "zip"],
    category: "public.app-category.books",
    identity: "-",
    // Replaces the ad-hoc identity with the fixed release certificate when available.
    sign: (options) => require("./mac-sign.cjs")(options),
    hardenedRuntime: false,
    notarize: false,
    artifactName: "Reader-${version}-mac-${arch}.${ext}",
  },
  dmg: { sign: false },
  win: {
    target: ["nsis"],
    signAndEditExecutable: false,
    artifactName: "Reader-${version}-win-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
};
