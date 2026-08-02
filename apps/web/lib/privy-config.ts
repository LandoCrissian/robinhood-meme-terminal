const PRIVY_APP_ID_LENGTH = 25;

export function normalizePrivyAppId(value: string | undefined) {
  const appId = value?.trim();
  return appId?.length === PRIVY_APP_ID_LENGTH ? appId : undefined;
}

export const configuredPrivyAppId = normalizePrivyAppId(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
export const speedWalletEnabled = Boolean(configuredPrivyAppId);
