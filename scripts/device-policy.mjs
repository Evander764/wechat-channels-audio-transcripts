export const REQUIRED_DEVICE_ID = 'win-desktop-5080';

export function policyStatus(env = process.env, platform = process.platform) {
  const deviceId = String(env.INFORMATION_INTAKE_DEVICE_ID || '').trim();
  const githubPreflight = String(env.INFORMATION_INTAKE_GITHUB_PREFLIGHT || '').trim();
  return {
    allowed: platform === 'win32' && deviceId === REQUIRED_DEVICE_ID && githubPreflight === 'PASS',
    platform,
    device_id: deviceId || 'unregistered',
    github_preflight: githubPreflight || 'missing',
    required_device_id: REQUIRED_DEVICE_ID,
  };
}

export function requireInformationIntakeControl(env = process.env, platform = process.platform) {
  const status = policyStatus(env, platform);
  if (status.allowed) return status;
  const error = new Error('blocked: real WeChat work must run on win-desktop-5080 through the GitHub-first Evander764/information-intake control plane');
  error.code = 'wechat_windows_5080_github_first_required';
  error.policy = status;
  throw error;
}
