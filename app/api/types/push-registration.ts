export type PushPlatform = 'ios' | 'android';

/**
 * Body shape accepted by `POST /push/register`.
 */
export type PushRegistration = {
    token: string;
    platform: PushPlatform;
    userAgent: string | null;
};
