const PROCESS_ENVIRONMENT_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "windir",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_ARCHITEW6432",
  "HOSTTYPE",
  "MACHTYPE",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "CI",
  "CONTINUOUS_INTEGRATION",
  "BUILDKITE",
  "CIRCLECI",
  "GITLAB_CI",
  "JENKINS_URL",
  "TF_BUILD",
  "TRAVIS",
  "GITHUB_ACTIONS",
  "GITHUB_ACTION",
  "GITHUB_ACTOR",
  "GITHUB_ACTOR_ID",
  "GITHUB_EVENT_NAME",
  "GITHUB_JOB",
  "GITHUB_REF",
  "GITHUB_REF_NAME",
  "GITHUB_REF_TYPE",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_NUMBER",
  "GITHUB_SERVER_URL",
  "GITHUB_SHA",
  "GITHUB_WORKFLOW",
  "GITHUB_WORKFLOW_REF",
  "GITHUB_WORKFLOW_SHA",
  "GITHUB_WORKSPACE",
  "RUNNER_ARCH",
  "RUNNER_ENVIRONMENT",
  "RUNNER_NAME",
  "RUNNER_OS",
  "RUNNER_TEMP",
  "RUNNER_TOOL_CACHE",
];

const INSTALL_LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall"];

export function npmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function createIsolatedEnvironment(source, { home, agentDir, npmCache, npmConfig }) {
  const environment = {};
  for (const key of PROCESS_ENVIRONMENT_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  return {
    ...environment,
    HOME: home,
    USERPROFILE: home,
    PI_CODING_AGENT_DIR: agentDir,
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_GLOBALCONFIG: npmConfig,
  };
}

export function replaceProcessEnvironment(environment) {
  const original = {};
  for (const key of Object.keys(process.env)) original[key] = process.env[key];
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);

  let restored = false;
  return () => {
    if (restored) return;
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
    restored = true;
  };
}

function packageLabel(manifest) {
  return `${manifest.name ?? "<unnamed>"}@${manifest.version ?? "<unversioned>"}`;
}

export function findInstallLifecycleScripts(packages) {
  const lifecycle = [];
  for (const { manifest } of packages) {
    for (const scriptName of INSTALL_LIFECYCLE_SCRIPTS) {
      if (typeof manifest.scripts?.[scriptName] === "string") {
        lifecycle.push(`${packageLabel(manifest)}: ${scriptName}=${manifest.scripts[scriptName]}`);
      }
    }
  }
  return lifecycle;
}
