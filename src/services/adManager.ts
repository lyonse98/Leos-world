import { supabase } from './supabase';
import { Position } from '../hooks/useGeolocation';

export interface AdCampaign {
  id: string;
  advertiser_name: string;
  ad_text: string;
  cta_text: string | null;
  target_region: string | null;
  target_speed_mode: string | null;
  max_impressions: number;
  current_impressions: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

export interface AdResult {
  text: string;
  campaignId: string;
}

const STORIES_BETWEEN_ADS = 4;
const SESSION_STORAGE_KEY = 'leo_stories_since_last_ad';

class AdManagerService {
  private storiesSinceLastAd: number = 0;

  constructor() {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      this.storiesSinceLastAd = parseInt(stored, 10) || 0;
    }
  }

  recordStoryPlayed(): void {
    this.storiesSinceLastAd++;
    sessionStorage.setItem(SESSION_STORAGE_KEY, String(this.storiesSinceLastAd));
  }

  shouldInsertAd(): boolean {
    return this.storiesSinceLastAd >= STORIES_BETWEEN_ADS;
  }

  async getAd(position: Position, movementMode: string): Promise<AdResult | null> {
    const { data, error } = await supabase
      .from('ad_campaigns')
      .select('*')
      .eq('active', true)
      .maybeSingle();

    if (error || !data) return null;

    const campaign = data as AdCampaign;

    if (campaign.target_speed_mode && campaign.target_speed_mode !== movementMode) {
      return null;
    }

    // The impression cap, the date window and the counter are all enforced in
    // one atomic statement server-side. A false result means the campaign was
    // exhausted or expired, so the ad is not played. The browser no longer
    // writes the counter, which is what made the cap racy and forgeable.
    const { data: claimed, error: claimError } = await supabase.rpc('record_ad_impression', {
      p_campaign_id: campaign.id,
      p_session_id: sessionStorage.getItem('leo_session_id') || 'unknown',
      p_lat: position.lat,
      p_lng: position.lng,
    });

    if (claimError || claimed !== true) return null;

    const fullText = campaign.cta_text
      ? `${campaign.ad_text} ${campaign.cta_text}`
      : campaign.ad_text;

    this.storiesSinceLastAd = 0;
    sessionStorage.setItem(SESSION_STORAGE_KEY, '0');

    return { text: fullText, campaignId: campaign.id };
  }

  reset(): void {
    this.storiesSinceLastAd = 0;
    sessionStorage.setItem(SESSION_STORAGE_KEY, '0');
  }
}

export const adManager = new AdManagerService();
