export type SubscriptionTier = 'free' | 'premium' | 'pro';

export interface SubscriptionConfig {
  tier: SubscriptionTier;
  adFree: boolean;
  maxStoriesPerSession: number;
  label: string;
}

export const SUBSCRIPTION_TIERS: Record<SubscriptionTier, SubscriptionConfig> = {
  free: {
    tier: 'free',
    adFree: false,
    maxStoriesPerSession: 0,
    label: 'Free',
  },
  premium: {
    tier: 'premium',
    adFree: true,
    maxStoriesPerSession: 0,
    label: 'Premium',
  },
  pro: {
    tier: 'pro',
    adFree: true,
    maxStoriesPerSession: 0,
    label: 'Pro',
  },
};

class SubscriptionService {
  private currentTier: SubscriptionTier = 'free';

  getTier(): SubscriptionTier {
    return this.currentTier;
  }

  getConfig(): SubscriptionConfig {
    return SUBSCRIPTION_TIERS[this.currentTier];
  }

  isAdFree(): boolean {
    return SUBSCRIPTION_TIERS[this.currentTier].adFree;
  }

  setTier(tier: SubscriptionTier): void {
    this.currentTier = tier;
  }

  reset(): void {
    this.currentTier = 'free';
  }
}

export const subscriptions = new SubscriptionService();
