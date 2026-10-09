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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_logs: {
        Row: {
          agent_name: string
          created_at: string | null
          id: number
          level: string
          market_id: string | null
          message: string
          metadata: Json | null
        }
        Insert: {
          agent_name: string
          created_at?: string | null
          id?: number
          level?: string
          market_id?: string | null
          message: string
          metadata?: Json | null
        }
        Update: {
          agent_name?: string
          created_at?: string | null
          id?: number
          level?: string
          market_id?: string | null
          message?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_logs_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      app_owner: {
        Row: {
          claimed_at: string | null
          id: number
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          id?: number
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      app_private: {
        Row: {
          name: string
          value: string
        }
        Insert: {
          name: string
          value: string
        }
        Update: {
          name?: string
          value?: string
        }
        Relationships: []
      }
      backtest_runs: {
        Row: {
          created_at: string | null
          error: string | null
          id: string
          params: Json | null
          status: string | null
          summary: Json | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          id?: string
          params?: Json | null
          status?: string | null
          summary?: Json | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          id?: string
          params?: Json | null
          status?: string | null
          summary?: Json | null
        }
        Relationships: []
      }
      backtest_trades: {
        Row: {
          bars_held: number | null
          coin: string | null
          entry_px: number | null
          entry_t: string | null
          exit_px: number | null
          exit_reason: string | null
          exit_t: string | null
          fee_r: number | null
          funding_r: number | null
          gross_r: number | null
          id: number
          net_r: number | null
          run_id: string | null
          sample: string | null
          setup: string | null
          side: string | null
          stop_px: number | null
          t1_px: number | null
          t2_px: number | null
        }
        Insert: {
          bars_held?: number | null
          coin?: string | null
          entry_px?: number | null
          entry_t?: string | null
          exit_px?: number | null
          exit_reason?: string | null
          exit_t?: string | null
          fee_r?: number | null
          funding_r?: number | null
          gross_r?: number | null
          id?: number
          net_r?: number | null
          run_id?: string | null
          sample?: string | null
          setup?: string | null
          side?: string | null
          stop_px?: number | null
          t1_px?: number | null
          t2_px?: number | null
        }
        Update: {
          bars_held?: number | null
          coin?: string | null
          entry_px?: number | null
          entry_t?: string | null
          exit_px?: number | null
          exit_reason?: string | null
          exit_t?: string | null
          fee_r?: number | null
          funding_r?: number | null
          gross_r?: number | null
          id?: number
          net_r?: number | null
          run_id?: string | null
          sample?: string | null
          setup?: string | null
          side?: string | null
          stop_px?: number | null
          t1_px?: number | null
          t2_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "backtest_trades_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_config: {
        Row: {
          budget_sek: number
          daily_loss_pct: number
          enabled_setups: string[]
          fee_pct: number
          id: number
          kill_drawdown_pct: number
          kill_switch: boolean
          max_open: number
          max_risk_pct: number
          min_order_usd: number
          mode: string
          night_rule: boolean
          review_window_minutes: number
          risk_pct: number
          slip_pct: number
          updated_at: string | null
          usd_sek: number | null
          usd_sek_updated_at: string | null
          weekly_loss_pct: number
        }
        Insert: {
          budget_sek?: number
          daily_loss_pct?: number
          enabled_setups?: string[]
          fee_pct?: number
          id?: number
          kill_drawdown_pct?: number
          kill_switch?: boolean
          max_open?: number
          max_risk_pct?: number
          min_order_usd?: number
          mode?: string
          night_rule?: boolean
          review_window_minutes?: number
          risk_pct?: number
          slip_pct?: number
          updated_at?: string | null
          usd_sek?: number | null
          usd_sek_updated_at?: string | null
          weekly_loss_pct?: number
        }
        Update: {
          budget_sek?: number
          daily_loss_pct?: number
          enabled_setups?: string[]
          fee_pct?: number
          id?: number
          kill_drawdown_pct?: number
          kill_switch?: boolean
          max_open?: number
          max_risk_pct?: number
          min_order_usd?: number
          mode?: string
          night_rule?: boolean
          review_window_minutes?: number
          risk_pct?: number
          slip_pct?: number
          updated_at?: string | null
          usd_sek?: number | null
          usd_sek_updated_at?: string | null
          weekly_loss_pct?: number
        }
        Relationships: []
      }
      hl_candles: {
        Row: {
          c: number | null
          coin: string
          h: number | null
          interval: string
          l: number | null
          o: number | null
          t: string
          v: number | null
        }
        Insert: {
          c?: number | null
          coin: string
          h?: number | null
          interval: string
          l?: number | null
          o?: number | null
          t: string
          v?: number | null
        }
        Update: {
          c?: number | null
          coin?: string
          h?: number | null
          interval?: string
          l?: number | null
          o?: number | null
          t?: string
          v?: number | null
        }
        Relationships: []
      }
      hl_funding: {
        Row: {
          coin: string
          premium: number | null
          rate: number | null
          t: string
        }
        Insert: {
          coin: string
          premium?: number | null
          rate?: number | null
          t: string
        }
        Update: {
          coin?: string
          premium?: number | null
          rate?: number | null
          t?: string
        }
        Relationships: []
      }
      hl_universe: {
        Row: {
          coin: string
          day_ntl_vlm: number | null
          funding: number | null
          mark_px: number | null
          max_leverage: number | null
          open_interest: number | null
          snapshot_at: string
        }
        Insert: {
          coin: string
          day_ntl_vlm?: number | null
          funding?: number | null
          mark_px?: number | null
          max_leverage?: number | null
          open_interest?: number | null
          snapshot_at: string
        }
        Update: {
          coin?: string
          day_ntl_vlm?: number | null
          funding?: number | null
          mark_px?: number | null
          max_leverage?: number | null
          open_interest?: number | null
          snapshot_at?: string
        }
        Relationships: []
      }
      markets: {
        Row: {
          color: string | null
          current_sek: number
          emoji: string | null
          id: string
          last_signal: string | null
          name: string
          seed_sek: number
          status: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          current_sek?: number
          emoji?: string | null
          id: string
          last_signal?: string | null
          name: string
          seed_sek?: number
          status?: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          current_sek?: number
          emoji?: string | null
          id?: string
          last_signal?: string | null
          name?: string
          seed_sek?: number
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      milestones: {
        Row: {
          id: number
          label: string
          notified: boolean | null
          reached_at: string | null
          target_sek: number
        }
        Insert: {
          id?: number
          label: string
          notified?: boolean | null
          reached_at?: string | null
          target_sek: number
        }
        Update: {
          id?: number
          label?: string
          notified?: boolean | null
          reached_at?: string | null
          target_sek?: number
        }
        Relationships: []
      }
      paper_equity: {
        Row: {
          equity_usd: number
          id: number
          note: string | null
          open_risk_usd: number
          t: string
        }
        Insert: {
          equity_usd: number
          id?: number
          note?: string | null
          open_risk_usd?: number
          t?: string
        }
        Update: {
          equity_usd?: number
          id?: number
          note?: string | null
          open_risk_usd?: number
          t?: string
        }
        Relationships: []
      }
      paper_positions: {
        Row: {
          bars_held: number
          coin: string
          entry_px: number
          entry_t: string
          exit_px: number | null
          exit_reason: string | null
          exit_t: string | null
          fees_usd: number
          funding_usd: number
          gross_usd: number
          id: string
          init_stop_px: number
          last_bar_t: string | null
          leverage: number
          margin_usd: number
          net_r: number | null
          net_usd: number | null
          notional_usd: number
          remaining_frac: number
          risk_usd: number
          setup: string
          shadow: boolean
          side: string
          signal_id: string | null
          size_coin: number
          status: string
          stop_px: number
          t1_hit: boolean
          t1_px: number
          t2_px: number
        }
        Insert: {
          bars_held?: number
          coin: string
          entry_px: number
          entry_t: string
          exit_px?: number | null
          exit_reason?: string | null
          exit_t?: string | null
          fees_usd?: number
          funding_usd?: number
          gross_usd?: number
          id?: string
          init_stop_px: number
          last_bar_t?: string | null
          leverage: number
          margin_usd: number
          net_r?: number | null
          net_usd?: number | null
          notional_usd: number
          remaining_frac?: number
          risk_usd: number
          setup: string
          shadow?: boolean
          side: string
          signal_id?: string | null
          size_coin: number
          status?: string
          stop_px: number
          t1_hit?: boolean
          t1_px: number
          t2_px: number
        }
        Update: {
          bars_held?: number
          coin?: string
          entry_px?: number
          entry_t?: string
          exit_px?: number | null
          exit_reason?: string | null
          exit_t?: string | null
          fees_usd?: number
          funding_usd?: number
          gross_usd?: number
          id?: string
          init_stop_px?: number
          last_bar_t?: string | null
          leverage?: number
          margin_usd?: number
          net_r?: number | null
          net_usd?: number | null
          notional_usd?: number
          remaining_frac?: number
          risk_usd?: number
          setup?: string
          shadow?: boolean
          side?: string
          signal_id?: string | null
          size_coin?: number
          status?: string
          stop_px?: number
          t1_hit?: boolean
          t1_px?: number
          t2_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_positions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_snapshots: {
        Row: {
          id: number
          snapshot_at: string | null
          total_sek: number
        }
        Insert: {
          id?: number
          snapshot_at?: string | null
          total_sek: number
        }
        Update: {
          id?: number
          snapshot_at?: string | null
          total_sek?: number
        }
        Relationships: []
      }
      signals: {
        Row: {
          coin: string
          context: Json | null
          created_at: string
          id: string
          ref_px: number
          regime: string | null
          review: Json | null
          reviewed_at: string | null
          risk_note: string | null
          setup: string
          side: string
          signal_bar_t: string
          status: string
          stop_dist_pct: number
          stop_px: number
          t1_px: number
          t2_px: number
        }
        Insert: {
          coin: string
          context?: Json | null
          created_at?: string
          id?: string
          ref_px: number
          regime?: string | null
          review?: Json | null
          reviewed_at?: string | null
          risk_note?: string | null
          setup: string
          side: string
          signal_bar_t: string
          status?: string
          stop_dist_pct: number
          stop_px: number
          t1_px: number
          t2_px: number
        }
        Update: {
          coin?: string
          context?: Json | null
          created_at?: string
          id?: string
          ref_px?: number
          regime?: string | null
          review?: Json | null
          reviewed_at?: string | null
          risk_note?: string | null
          setup?: string
          side?: string
          signal_bar_t?: string
          status?: string
          stop_dist_pct?: number
          stop_px?: number
          t1_px?: number
          t2_px?: number
        }
        Relationships: []
      }
      trades: {
        Row: {
          action: string
          asset: string
          closed_at: string | null
          entry_price: number
          exit_price: number | null
          id: string
          market_id: string
          mode: string
          opened_at: string | null
          pnl_pct: number | null
          pnl_sek: number | null
          quantity: number
          status: string
          stop_loss: number | null
          take_profit: number | null
        }
        Insert: {
          action: string
          asset: string
          closed_at?: string | null
          entry_price: number
          exit_price?: number | null
          id?: string
          market_id: string
          mode?: string
          opened_at?: string | null
          pnl_pct?: number | null
          pnl_sek?: number | null
          quantity?: number
          status?: string
          stop_loss?: number | null
          take_profit?: number | null
        }
        Update: {
          action?: string
          asset?: string
          closed_at?: string | null
          entry_price?: number
          exit_price?: number | null
          id?: string
          market_id?: string
          mode?: string
          opened_at?: string | null
          pnl_pct?: number | null
          pnl_sek?: number | null
          quantity?: number
          status?: string
          stop_loss?: number | null
          take_profit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trades_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hl_backtest_data: { Args: { p_coin: string }; Returns: Json }
      hl_latest_t: { Args: { p_coin: string }; Returns: Json }
      is_owner: { Args: never; Returns: boolean }
      submit_review: {
        Args: {
          p_confidence: number
          p_crowding_flag: boolean
          p_decision: string
          p_notes: Json
          p_signal_id: string
        }
        Returns: {
          coin: string
          context: Json | null
          created_at: string
          id: string
          ref_px: number
          regime: string | null
          review: Json | null
          reviewed_at: string | null
          risk_note: string | null
          setup: string
          side: string
          signal_bar_t: string
          status: string
          stop_dist_pct: number
          stop_px: number
          t1_px: number
          t2_px: number
        }
        SetofOptions: {
          from: "*"
          to: "signals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_cron_secret: { Args: { p_token: string }; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
