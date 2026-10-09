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
