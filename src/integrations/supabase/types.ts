export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      gm_ad_views: {
        Row: {
          coins: number
          created_at: string
          id: number
          telegram_id: number
        }
        Insert: {
          coins?: number
          created_at?: string
          id?: number
          telegram_id: number
        }
        Update: {
          coins?: number
          created_at?: string
          id?: number
          telegram_id?: number
        }
        Relationships: []
      }
      gm_channels: {
        Row: {
          channel_name: string | null
          channel_username: string
          created_at: string
          id: number
        }
        Insert: {
          channel_name?: string | null
          channel_username: string
          created_at?: string
          id?: number
        }
        Update: {
          channel_name?: string | null
          channel_username?: string
          created_at?: string
          id?: number
        }
        Relationships: []
      }
      gm_combo_attempts: {
        Row: {
          combo_date: string
          created_at: string
          id: number
          reward: number
          success: boolean
          telegram_id: number
        }
        Insert: {
          combo_date: string
          created_at?: string
          id?: number
          reward?: number
          success: boolean
          telegram_id: number
        }
        Update: {
          combo_date?: string
          created_at?: string
          id?: number
          reward?: number
          success?: boolean
          telegram_id?: number
        }
        Relationships: []
      }
      gm_daily_checkins: {
        Row: {
          created_at: string
          id: number
          last_claim_at: string | null
          streak_day: number
          telegram_id: number
          total_claims: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          last_claim_at?: string | null
          streak_day?: number
          telegram_id: number
          total_claims?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          last_claim_at?: string | null
          streak_day?: number
          telegram_id?: number
          total_claims?: number
          updated_at?: string
        }
        Relationships: []
      }
      gm_deposits: {
        Row: {
          amount: number
          confirmations: number
          created_at: string
          credited_at: string | null
          id: number
          processed_at: string | null
          rejection_reason: string | null
          status: string
          telegram_id: number
          tx_hash: string
          wallet_address: string
        }
        Insert: {
          amount: number
          confirmations?: number
          created_at?: string
          credited_at?: string | null
          id?: number
          processed_at?: string | null
          rejection_reason?: string | null
          status?: string
          telegram_id: number
          tx_hash: string
          wallet_address: string
        }
        Update: {
          amount?: number
          confirmations?: number
          created_at?: string
          credited_at?: string | null
          id?: number
          processed_at?: string | null
          rejection_reason?: string | null
          status?: string
          telegram_id?: number
          tx_hash?: string
          wallet_address?: string
        }
        Relationships: []
      }
      gm_earnings_log: {
        Row: {
          amount: number
          created_at: string
          id: number
          telegram_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          id?: number
          telegram_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          id?: number
          telegram_id?: number
        }
        Relationships: []
      }
      gm_gift_entries: {
        Row: {
          chances: number
          created_at: string
          gift_id: number
          id: number
          invited_count: number
          referred_by: number | null
          telegram_id: number
        }
        Insert: {
          chances?: number
          created_at?: string
          gift_id: number
          id?: number
          invited_count?: number
          referred_by?: number | null
          telegram_id: number
        }
        Update: {
          chances?: number
          created_at?: string
          gift_id?: number
          id?: number
          invited_count?: number
          referred_by?: number | null
          telegram_id?: number
        }
        Relationships: []
      }
      gm_gift_invites: {
        Row: {
          created_at: string
          invitee_id: number
          referrer_id: number
        }
        Insert: {
          created_at?: string
          invitee_id: number
          referrer_id: number
        }
        Update: {
          created_at?: string
          invitee_id?: number
          referrer_id?: number
        }
        Relationships: []
      }
      gm_promo_codes: {
        Row: {
          code: string
          created_at: string
          current_uses: number
          id: number
          is_active: boolean
          max_uses: number
          reward_coins: number
        }
        Insert: {
          code: string
          created_at?: string
          current_uses?: number
          id?: number
          is_active?: boolean
          max_uses?: number
          reward_coins?: number
        }
        Update: {
          code?: string
          created_at?: string
          current_uses?: number
          id?: number
          is_active?: boolean
          max_uses?: number
          reward_coins?: number
        }
        Relationships: []
      }
      gm_promo_redemptions: {
        Row: {
          code_id: number
          created_at: string
          id: number
          reward_coins: number
          telegram_id: number
        }
        Insert: {
          code_id: number
          created_at?: string
          id?: number
          reward_coins?: number
          telegram_id: number
        }
        Update: {
          code_id?: number
          created_at?: string
          id?: number
          reward_coins?: number
          telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "gm_promo_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "gm_promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      gm_referral_milestone_credits: {
        Row: {
          credited_at: string
          id: number
          milestone_id: number
          telegram_id: number
        }
        Insert: {
          credited_at?: string
          id?: number
          milestone_id: number
          telegram_id: number
        }
        Update: {
          credited_at?: string
          id?: number
          milestone_id?: number
          telegram_id?: number
        }
        Relationships: []
      }
      gm_referral_milestones: {
        Row: {
          created_at: string
          id: number
          invite_count: number
          is_enabled: boolean
          reward_coins: number
        }
        Insert: {
          created_at?: string
          id?: number
          invite_count: number
          is_enabled?: boolean
          reward_coins?: number
        }
        Update: {
          created_at?: string
          id?: number
          invite_count?: number
          is_enabled?: boolean
          reward_coins?: number
        }
        Relationships: []
      }
      gm_referrals: {
        Row: {
          created_at: string
          id: number
          referred_id: number
          referrer_id: number
          reward_paid: boolean
        }
        Insert: {
          created_at?: string
          id?: number
          referred_id: number
          referrer_id: number
          reward_paid?: boolean
        }
        Update: {
          created_at?: string
          id?: number
          referred_id?: number
          referrer_id?: number
          reward_paid?: boolean
        }
        Relationships: []
      }
      gm_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      gm_store_products: {
        Row: {
          coin_price: number
          created_at: string
          daily_mining_pct: number
          description: string | null
          gram_value: number
          id: number
          is_enabled: boolean
          name: string
        }
        Insert: {
          coin_price: number
          created_at?: string
          daily_mining_pct?: number
          description?: string | null
          gram_value?: number
          id?: number
          is_enabled?: boolean
          name: string
        }
        Update: {
          coin_price?: number
          created_at?: string
          daily_mining_pct?: number
          description?: string | null
          gram_value?: number
          id?: number
          is_enabled?: boolean
          name?: string
        }
        Relationships: []
      }
      gm_store_purchases: {
        Row: {
          coins_paid: number
          daily_mining_pct: number
          gram_value: number
          id: number
          last_claim_at: string | null
          principal_remaining: number
          product_id: number
          purchased_at: string
          telegram_id: number
        }
        Insert: {
          coins_paid: number
          daily_mining_pct?: number
          gram_value?: number
          id?: number
          last_claim_at?: string | null
          principal_remaining?: number
          product_id: number
          purchased_at?: string
          telegram_id: number
        }
        Update: {
          coins_paid?: number
          daily_mining_pct?: number
          gram_value?: number
          id?: number
          last_claim_at?: string | null
          principal_remaining?: number
          product_id?: number
          purchased_at?: string
          telegram_id?: number
        }
        Relationships: []
      }
      gm_support_messages: {
        Row: {
          created_at: string
          id: number
          kind: string
          message: string
          status: string
          telegram_id: number
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          kind?: string
          message: string
          status?: string
          telegram_id: number
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          kind?: string
          message?: string
          status?: string
          telegram_id?: number
          username?: string | null
        }
        Relationships: []
      }
      gm_swaps: {
        Row: {
          coins_amount: number
          created_at: string
          direction: string
          gram_amount: number
          id: number
          rate: number
          telegram_id: number
        }
        Insert: {
          coins_amount: number
          created_at?: string
          direction: string
          gram_amount: number
          id?: number
          rate: number
          telegram_id: number
        }
        Update: {
          coins_amount?: number
          created_at?: string
          direction?: string
          gram_amount?: number
          id?: number
          rate?: number
          telegram_id?: number
        }
        Relationships: []
      }
      gm_task_completions: {
        Row: {
          completed_at: string
          id: number
          task_id: number
          telegram_id: number
        }
        Insert: {
          completed_at?: string
          id?: number
          task_id: number
          telegram_id: number
        }
        Update: {
          completed_at?: string
          id?: number
          task_id?: number
          telegram_id?: number
        }
        Relationships: []
      }
      gm_task_submissions: {
        Row: {
          created_at: string
          id: number
          kind: string
          payload: string
          reject_reason: string | null
          reviewed_at: string | null
          status: string
          task_id: number
          telegram_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          kind: string
          payload: string
          reject_reason?: string | null
          reviewed_at?: string | null
          status?: string
          task_id: number
          telegram_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          kind?: string
          payload?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          status?: string
          task_id?: number
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      gm_tasks: {
        Row: {
          bot_username: string | null
          category: string
          channel_username: string | null
          chat_id: string | null
          created_at: string
          description: string | null
          id: number
          is_daily: boolean
          is_enabled: boolean
          is_hidden: boolean
          join_link: string | null
          reward: number
          slot_limit: number | null
          task_type: string | null
          title: string
          twitter_url: string | null
        }
        Insert: {
          bot_username?: string | null
          category?: string
          channel_username?: string | null
          chat_id?: string | null
          created_at?: string
          description?: string | null
          id?: number
          is_daily?: boolean
          is_enabled?: boolean
          is_hidden?: boolean
          join_link?: string | null
          reward?: number
          slot_limit?: number | null
          task_type?: string | null
          title: string
          twitter_url?: string | null
        }
        Update: {
          bot_username?: string | null
          category?: string
          channel_username?: string | null
          chat_id?: string | null
          created_at?: string
          description?: string | null
          id?: number
          is_daily?: boolean
          is_enabled?: boolean
          is_hidden?: boolean
          join_link?: string | null
          reward?: number
          slot_limit?: number | null
          task_type?: string | null
          title?: string
          twitter_url?: string | null
        }
        Relationships: []
      }
      gm_tournaments: {
        Row: {
          created_at: string
          ends_at: string
          id: number
          prizes: string
          settled_at: string | null
          snapshot: string | null
          starts_at: string
          status: string
          title: string
          top_n: number
          tournament_type: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: number
          prizes?: string
          settled_at?: string | null
          snapshot?: string | null
          starts_at?: string
          status?: string
          title: string
          top_n?: number
          tournament_type?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: number
          prizes?: string
          settled_at?: string | null
          snapshot?: string | null
          starts_at?: string
          status?: string
          title?: string
          top_n?: number
          tournament_type?: string
        }
        Relationships: []
      }
      gm_user_ips: {
        Row: {
          country_code: string | null
          country_name: string | null
          created_at: string
          id: number
          ip: string
          last_seen_at: string
          telegram_id: number
        }
        Insert: {
          country_code?: string | null
          country_name?: string | null
          created_at?: string
          id?: number
          ip: string
          last_seen_at?: string
          telegram_id: number
        }
        Update: {
          country_code?: string | null
          country_name?: string | null
          created_at?: string
          id?: number
          ip?: string
          last_seen_at?: string
          telegram_id?: number
        }
        Relationships: []
      }
      gm_users: {
        Row: {
          balance: number
          blocked_bot: boolean
          coins: number
          created_at: string
          first_name: string | null
          id: number
          is_banned: boolean
          language: string | null
          last_active_at: string | null
          last_claim_at: string
          last_mining_at: string | null
          last_name: string | null
          miners_last_claim_at: number | null
          miners_levels: Json
          mining_coins: number | null
          mining_rate: number
          mining_started_at: string | null
          referred_by: number | null
          restrict_withdrawal: boolean
          telegram_id: number
          twitter_handle: string | null
          twitter_linked_at: string | null
          unclaimed_mining_balance: number
          username: string | null
          wallet_address: string | null
        }
        Insert: {
          balance?: number
          blocked_bot?: boolean
          coins?: number
          created_at?: string
          first_name?: string | null
          id?: number
          is_banned?: boolean
          language?: string | null
          last_active_at?: string | null
          last_claim_at?: string
          last_mining_at?: string | null
          last_name?: string | null
          miners_last_claim_at?: number | null
          miners_levels?: Json
          mining_coins?: number | null
          mining_rate?: number
          mining_started_at?: string | null
          referred_by?: number | null
          restrict_withdrawal?: boolean
          telegram_id: number
          twitter_handle?: string | null
          twitter_linked_at?: string | null
          unclaimed_mining_balance?: number
          username?: string | null
          wallet_address?: string | null
        }
        Update: {
          balance?: number
          blocked_bot?: boolean
          coins?: number
          created_at?: string
          first_name?: string | null
          id?: number
          is_banned?: boolean
          language?: string | null
          last_active_at?: string | null
          last_claim_at?: string
          last_mining_at?: string | null
          last_name?: string | null
          miners_last_claim_at?: number | null
          miners_levels?: Json
          mining_coins?: number | null
          mining_rate?: number
          mining_started_at?: string | null
          referred_by?: number | null
          restrict_withdrawal?: boolean
          telegram_id?: number
          twitter_handle?: string | null
          twitter_linked_at?: string | null
          unclaimed_mining_balance?: number
          username?: string | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      gm_withdrawals: {
        Row: {
          amount: number
          channel_message_id: number | null
          created_at: string
          id: number
          processed_at: string | null
          rejection_reason: string | null
          status: string
          telegram_id: number
          tx_hash: string | null
          wallet_address: string
        }
        Insert: {
          amount: number
          channel_message_id?: number | null
          created_at?: string
          id?: number
          processed_at?: string | null
          rejection_reason?: string | null
          status?: string
          telegram_id: number
          tx_hash?: string | null
          wallet_address: string
        }
        Update: {
          amount?: number
          channel_message_id?: number | null
          created_at?: string
          id?: number
          processed_at?: string | null
          rejection_reason?: string | null
          status?: string
          telegram_id?: number
          tx_hash?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gm_claim_passive_mining: {
        Args: { _minimum_claim?: number; _telegram_id: number }
        Returns: {
          claimed_amount: number
          new_balance: number
          new_last_claim_at: string
          new_mining_rate: number
        }[]
      }
      gm_mining_daily_pct: { Args: never; Returns: number }
      gm_mining_rate_for_coins: { Args: { _coins: number }; Returns: number }
      gm_recalc_all_mining_rates: { Args: never; Returns: undefined }
      gm_set_mining_daily_pct: { Args: { _pct: number }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
