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
      cr_accounts: {
        Row: {
          created_at: string
          handle: string
          id: string
          linked_in_whop: boolean
          notes: string | null
          platform: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          handle: string
          id?: string
          linked_in_whop?: boolean
          notes?: string | null
          platform: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          handle?: string
          id?: string
          linked_in_whop?: boolean
          notes?: string | null
          platform?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      cr_agent_runs: {
        Row: {
          agent_key: string
          finished_at: string | null
          id: number
          items_processed: number
          started_at: string
          status: string
          summary: string | null
        }
        Insert: {
          agent_key: string
          finished_at?: string | null
          id?: number
          items_processed?: number
          started_at?: string
          status?: string
          summary?: string | null
        }
        Update: {
          agent_key?: string
          finished_at?: string | null
          id?: number
          items_processed?: number
          started_at?: string
          status?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cr_agent_runs_agent_key_fkey"
            columns: ["agent_key"]
            isOneToOne: false
            referencedRelation: "cr_agents"
            referencedColumns: ["key"]
          },
        ]
      }
      cr_agents: {
        Row: {
          autonomy: string
          description: string | null
          enabled: boolean
          key: string
          last_run_at: string | null
          last_status: string | null
          name: string
          next_run_at: string | null
          role: string | null
          schedule_text: string | null
          sort: number
        }
        Insert: {
          autonomy?: string
          description?: string | null
          enabled?: boolean
          key: string
          last_run_at?: string | null
          last_status?: string | null
          name: string
          next_run_at?: string | null
          role?: string | null
          schedule_text?: string | null
          sort?: number
        }
        Update: {
          autonomy?: string
          description?: string | null
          enabled?: boolean
          key?: string
          last_run_at?: string | null
          last_status?: string | null
          name?: string
          next_run_at?: string | null
          role?: string | null
          schedule_text?: string | null
          sort?: number
        }
        Relationships: []
      }
      cr_campaigns: {
        Row: {
          brand: string | null
          budget_remaining_usd: number | null
          budget_total_usd: number | null
          category: string
          created_at: string
          deadline: string | null
          disclosure_required: boolean
          flat_fee_usd: number | null
          id: string
          max_length_s: number | null
          max_payout_usd: number | null
          min_length_s: number | null
          min_payout_usd: number | null
          notes: string | null
          platforms: string[]
          prohibited: string | null
          rate_per_1k_usd: number | null
          red_flags: string[]
          required_credit: string | null
          required_hashtags: string[]
          score: number | null
          source_assets: string[]
          status: string
          title: string | null
          updated_at: string
          whop_url: string
        }
        Insert: {
          brand?: string | null
          budget_remaining_usd?: number | null
          budget_total_usd?: number | null
          category?: string
          created_at?: string
          deadline?: string | null
          disclosure_required?: boolean
          flat_fee_usd?: number | null
          id?: string
          max_length_s?: number | null
          max_payout_usd?: number | null
          min_length_s?: number | null
          min_payout_usd?: number | null
          notes?: string | null
          platforms?: string[]
          prohibited?: string | null
          rate_per_1k_usd?: number | null
          red_flags?: string[]
          required_credit?: string | null
          required_hashtags?: string[]
          score?: number | null
          source_assets?: string[]
          status?: string
          title?: string | null
          updated_at?: string
          whop_url: string
        }
        Update: {
          brand?: string | null
          budget_remaining_usd?: number | null
          budget_total_usd?: number | null
          category?: string
          created_at?: string
          deadline?: string | null
          disclosure_required?: boolean
          flat_fee_usd?: number | null
          id?: string
          max_length_s?: number | null
          max_payout_usd?: number | null
          min_length_s?: number | null
          min_payout_usd?: number | null
          notes?: string | null
          platforms?: string[]
          prohibited?: string | null
          rate_per_1k_usd?: number | null
          red_flags?: string[]
          required_credit?: string | null
          required_hashtags?: string[]
          score?: number | null
          source_assets?: string[]
          status?: string
          title?: string | null
          updated_at?: string
          whop_url?: string
        }
        Relationships: []
      }
      cr_clips: {
        Row: {
          campaign_id: string
          created_at: string
          created_by_agent: string | null
          file_ref: string | null
          hook: string | null
          id: string
          qa_notes: string | null
          source_end_s: number | null
          source_start_s: number | null
          source_url: string | null
          stage: string
          updated_at: string
          value_layer: string | null
          variant: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by_agent?: string | null
          file_ref?: string | null
          hook?: string | null
          id?: string
          qa_notes?: string | null
          source_end_s?: number | null
          source_start_s?: number | null
          source_url?: string | null
          stage?: string
          updated_at?: string
          value_layer?: string | null
          variant?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by_agent?: string | null
          file_ref?: string | null
          hook?: string | null
          id?: string
          qa_notes?: string | null
          source_end_s?: number | null
          source_start_s?: number | null
          source_url?: string | null
          stage?: string
          updated_at?: string
          value_layer?: string | null
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cr_clips_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "cr_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      cr_posts: {
        Row: {
          account_id: string | null
          caption: string | null
          clip_id: string
          created_at: string
          denial_reason: string | null
          earning_window_ends_at: string | null
          est_earnings_usd: number
          id: string
          paid_usd: number
          payout_eta: string | null
          platform: string | null
          post_url: string
          posted_at: string | null
          submission_status: string
          updated_at: string
          views_24h: number | null
          views_72h: number | null
          views_7d: number | null
          views_current: number
          whop_submission_id: string | null
        }
        Insert: {
          account_id?: string | null
          caption?: string | null
          clip_id: string
          created_at?: string
          denial_reason?: string | null
          earning_window_ends_at?: string | null
          est_earnings_usd?: number
          id?: string
          paid_usd?: number
          payout_eta?: string | null
          platform?: string | null
          post_url: string
          posted_at?: string | null
          submission_status?: string
          updated_at?: string
          views_24h?: number | null
          views_72h?: number | null
          views_7d?: number | null
          views_current?: number
          whop_submission_id?: string | null
        }
        Update: {
          account_id?: string | null
          caption?: string | null
          clip_id?: string
          created_at?: string
          denial_reason?: string | null
          earning_window_ends_at?: string | null
          est_earnings_usd?: number
          id?: string
          paid_usd?: number
          payout_eta?: string | null
          platform?: string | null
          post_url?: string
          posted_at?: string | null
          submission_status?: string
          updated_at?: string
          views_24h?: number | null
          views_72h?: number | null
          views_7d?: number | null
          views_current?: number
          whop_submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cr_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "cr_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_posts_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "cr_clips"
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
          live_armed: boolean
          live_armed_at: string | null
          live_fills_cursor_ms: number | null
          live_last_reconcile_at: string | null
          live_lock_owner: string | null
          live_lock_until: string | null
          live_min_volume_usd: number
          live_setups: string[]
          live_start_equity_usd: number | null
          live_trip_reason: string | null
          live_trip_streak: number
          live_whitelist: string[]
          max_entries_per_day: number
          max_open: number
          max_risk_pct: number
          min_order_usd: number
          mode: string
          night_rule: boolean
          paper_extra_coins: string[]
          review_window_minutes: number
          risk_pct: number
          slip_pct: number
          smoke_test_passed_at: string | null
          smoke_test_result: Json | null
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
          live_armed?: boolean
          live_armed_at?: string | null
          live_fills_cursor_ms?: number | null
          live_last_reconcile_at?: string | null
          live_lock_owner?: string | null
          live_lock_until?: string | null
          live_min_volume_usd?: number
          live_setups?: string[]
          live_start_equity_usd?: number | null
          live_trip_reason?: string | null
          live_trip_streak?: number
          live_whitelist?: string[]
          max_entries_per_day?: number
          max_open?: number
          max_risk_pct?: number
          min_order_usd?: number
          mode?: string
          night_rule?: boolean
          paper_extra_coins?: string[]
          review_window_minutes?: number
          risk_pct?: number
          slip_pct?: number
          smoke_test_passed_at?: string | null
          smoke_test_result?: Json | null
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
          live_armed?: boolean
          live_armed_at?: string | null
          live_fills_cursor_ms?: number | null
          live_last_reconcile_at?: string | null
          live_lock_owner?: string | null
          live_lock_until?: string | null
          live_min_volume_usd?: number
          live_setups?: string[]
          live_start_equity_usd?: number | null
          live_trip_reason?: string | null
          live_trip_streak?: number
          live_whitelist?: string[]
          max_entries_per_day?: number
          max_open?: number
          max_risk_pct?: number
          min_order_usd?: number
          mode?: string
          night_rule?: boolean
          paper_extra_coins?: string[]
          review_window_minutes?: number
          risk_pct?: number
          slip_pct?: number
          smoke_test_passed_at?: string | null
          smoke_test_result?: Json | null
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
      live_equity: {
        Row: {
          account_value_usd: number
          expected_usd: number | null
          id: number
          note: string | null
          t: string
          unrealized_usd: number | null
          withdrawable_usd: number | null
        }
        Insert: {
          account_value_usd: number
          expected_usd?: number | null
          id?: number
          note?: string | null
          t?: string
          unrealized_usd?: number | null
          withdrawable_usd?: number | null
        }
        Update: {
          account_value_usd?: number
          expected_usd?: number | null
          id?: number
          note?: string | null
          t?: string
          unrealized_usd?: number | null
          withdrawable_usd?: number | null
        }
        Relationships: []
      }
      live_fills: {
        Row: {
          closed_pnl: number
          coin: string
          dir: string | null
          fee: number
          fee_token: string | null
          hash: string | null
          network: string
          oid: number | null
          position_id: string | null
          px: number
          raw: Json | null
          side: string
          sz: number
          tid: number
          time: string
        }
        Insert: {
          closed_pnl?: number
          coin: string
          dir?: string | null
          fee?: number
          fee_token?: string | null
          hash?: string | null
          network: string
          oid?: number | null
          position_id?: string | null
          px: number
          raw?: Json | null
          side: string
          sz: number
          tid: number
          time: string
        }
        Update: {
          closed_pnl?: number
          coin?: string
          dir?: string | null
          fee?: number
          fee_token?: string | null
          hash?: string | null
          network?: string
          oid?: number | null
          position_id?: string | null
          px?: number
          raw?: Json | null
          side?: string
          sz?: number
          tid?: number
          time?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_fills_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "live_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      live_orders: {
        Row: {
          cloid: string | null
          coin: string
          created_at: string
          dry_run: boolean
          error: string | null
          id: number
          is_buy: boolean
          kind: string
          network: string
          oid: number | null
          position_id: string | null
          px: number | null
          raw: Json | null
          reduce_only: boolean
          size: number | null
          status: string
          trigger_px: number | null
        }
        Insert: {
          cloid?: string | null
          coin: string
          created_at?: string
          dry_run?: boolean
          error?: string | null
          id?: number
          is_buy: boolean
          kind: string
          network: string
          oid?: number | null
          position_id?: string | null
          px?: number | null
          raw?: Json | null
          reduce_only: boolean
          size?: number | null
          status: string
          trigger_px?: number | null
        }
        Update: {
          cloid?: string | null
          coin?: string
          created_at?: string
          dry_run?: boolean
          error?: string | null
          id?: number
          is_buy?: boolean
          kind?: string
          network?: string
          oid?: number | null
          position_id?: string | null
          px?: number | null
          raw?: Json | null
          reduce_only?: boolean
          size?: number | null
          status?: string
          trigger_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "live_orders_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "live_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      live_positions: {
        Row: {
          be_moved: boolean
          close_attempts: number
          close_reason: string | null
          coin: string
          entry_px: number | null
          entry_t: string
          exit_px: number | null
          exit_t: string | null
          fees_usd: number | null
          funding_usd: number | null
          id: string
          init_size: number | null
          init_stop_px: number
          leverage: number | null
          net_usd: number | null
          network: string
          note: string | null
          notional_usd: number | null
          paper_position_id: string | null
          realized_pnl_usd: number | null
          risk_usd: number | null
          setup: string
          side: string
          signal_id: string | null
          size: number
          sl_oid: number | null
          status: string
          stop_px: number
          t1_done: boolean
          t1_oid: number | null
          t1_px: number | null
          t2_oid: number | null
          t2_px: number | null
          updated_at: string | null
          usd_sek_at_entry: number | null
          usd_sek_at_exit: number | null
        }
        Insert: {
          be_moved?: boolean
          close_attempts?: number
          close_reason?: string | null
          coin: string
          entry_px?: number | null
          entry_t?: string
          exit_px?: number | null
          exit_t?: string | null
          fees_usd?: number | null
          funding_usd?: number | null
          id?: string
          init_size?: number | null
          init_stop_px: number
          leverage?: number | null
          net_usd?: number | null
          network: string
          note?: string | null
          notional_usd?: number | null
          paper_position_id?: string | null
          realized_pnl_usd?: number | null
          risk_usd?: number | null
          setup: string
          side: string
          signal_id?: string | null
          size?: number
          sl_oid?: number | null
          status?: string
          stop_px: number
          t1_done?: boolean
          t1_oid?: number | null
          t1_px?: number | null
          t2_oid?: number | null
          t2_px?: number | null
          updated_at?: string | null
          usd_sek_at_entry?: number | null
          usd_sek_at_exit?: number | null
        }
        Update: {
          be_moved?: boolean
          close_attempts?: number
          close_reason?: string | null
          coin?: string
          entry_px?: number | null
          entry_t?: string
          exit_px?: number | null
          exit_t?: string | null
          fees_usd?: number | null
          funding_usd?: number | null
          id?: string
          init_size?: number | null
          init_stop_px?: number
          leverage?: number | null
          net_usd?: number | null
          network?: string
          note?: string | null
          notional_usd?: number | null
          paper_position_id?: string | null
          realized_pnl_usd?: number | null
          risk_usd?: number | null
          setup?: string
          side?: string
          signal_id?: string | null
          size?: number
          sl_oid?: number | null
          status?: string
          stop_px?: number
          t1_done?: boolean
          t1_oid?: number | null
          t1_px?: number | null
          t2_oid?: number | null
          t2_px?: number | null
          updated_at?: string | null
          usd_sek_at_entry?: number | null
          usd_sek_at_exit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "live_positions_paper_position_id_fkey"
            columns: ["paper_position_id"]
            isOneToOne: false
            referencedRelation: "paper_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_positions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
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
      mimic_trades: {
        Row: {
          address: string
          closed_at: string | null
          coin: string
          entry_px: number
          exit_px: number | null
          exit_reason: string | null
          fees_usd: number
          id: string
          net_pct: number | null
          net_usd: number | null
          notional_usd: number
          opened_at: string
          side: string
          status: string
          their_entry_px: number | null
          their_leverage: number | null
        }
        Insert: {
          address: string
          closed_at?: string | null
          coin: string
          entry_px: number
          exit_px?: number | null
          exit_reason?: string | null
          fees_usd?: number
          id?: string
          net_pct?: number | null
          net_usd?: number | null
          notional_usd: number
          opened_at?: string
          side: string
          status?: string
          their_entry_px?: number | null
          their_leverage?: number | null
        }
        Update: {
          address?: string
          closed_at?: string | null
          coin?: string
          entry_px?: number
          exit_px?: number | null
          exit_reason?: string | null
          fees_usd?: number
          id?: string
          net_pct?: number | null
          net_usd?: number | null
          notional_usd?: number
          opened_at?: string
          side?: string
          status?: string
          their_entry_px?: number | null
          their_leverage?: number | null
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
          follow_wallets: string[] | null
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
          shadow_reason: string | null
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
          follow_wallets?: string[] | null
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
          shadow_reason?: string | null
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
          follow_wallets?: string[] | null
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
          shadow_reason?: string | null
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
      rate_budget: {
        Row: {
          cap: number
          id: number
          used: number
          window_start: string
        }
        Insert: {
          cap?: number
          id?: number
          used?: number
          window_start?: string
        }
        Update: {
          cap?: number
          id?: number
          used?: number
          window_start?: string
        }
        Relationships: []
      }
      signals: {
        Row: {
          coin: string
          context: Json | null
          created_at: string
          id: string
          live_note: string | null
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
          live_note?: string | null
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
          live_note?: string | null
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
      sm_events: {
        Row: {
          address: string
          coin: string
          entry_px: number | null
          id: number
          kind: string
          leverage: number | null
          notional_frac: number | null
          processed: boolean
          side: string
          size: number | null
          t: string
        }
        Insert: {
          address: string
          coin: string
          entry_px?: number | null
          id?: number
          kind: string
          leverage?: number | null
          notional_frac?: number | null
          processed?: boolean
          side: string
          size?: number | null
          t?: string
        }
        Update: {
          address?: string
          coin?: string
          entry_px?: number | null
          id?: number
          kind?: string
          leverage?: number | null
          notional_frac?: number | null
          processed?: boolean
          side?: string
          size?: number | null
          t?: string
        }
        Relationships: []
      }
      sm_invo_daily: {
        Row: {
          address: string
          day: string
          fills: number
          opens: number
          originated: number
        }
        Insert: {
          address: string
          day: string
          fills?: number
          opens?: number
          originated?: number
        }
        Update: {
          address?: string
          day?: string
          fills?: number
          opens?: number
          originated?: number
        }
        Relationships: []
      }
      sm_invo_days: {
        Row: {
          day: string
          ingested_at: string
          rows: number
          status: string
        }
        Insert: {
          day: string
          ingested_at?: string
          rows: number
          status: string
        }
        Update: {
          day?: string
          ingested_at?: string
          rows?: number
          status?: string
        }
        Relationships: []
      }
      sm_jobs: {
        Row: {
          name: string
          state: Json
          updated_at: string
        }
        Insert: {
          name: string
          state?: Json
          updated_at?: string
        }
        Update: {
          name?: string
          state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      sm_positions: {
        Row: {
          account_value: number | null
          address: string
          coin: string
          entry_px: number | null
          leverage: number | null
          notional: number | null
          opened_at: string
          side: string
          szi: number
          updated_at: string
        }
        Insert: {
          account_value?: number | null
          address: string
          coin: string
          entry_px?: number | null
          leverage?: number | null
          notional?: number | null
          opened_at?: string
          side: string
          szi: number
          updated_at?: string
        }
        Update: {
          account_value?: number | null
          address?: string
          coin?: string
          entry_px?: number | null
          leverage?: number | null
          notional?: number | null
          opened_at?: string
          side?: string
          szi?: number
          updated_at?: string
        }
        Relationships: []
      }
      sm_scores: {
        Row: {
          address: string
          base: number | null
          cap: number | null
          components: Json | null
          computed_at: string
          eligible: boolean
          fast: boolean
          filters: Json | null
          mirror: boolean
          practice: boolean
          score: number
          tier: string | null
          tracked_at: string | null
          watchlist: boolean
        }
        Insert: {
          address: string
          base?: number | null
          cap?: number | null
          components?: Json | null
          computed_at?: string
          eligible?: boolean
          fast?: boolean
          filters?: Json | null
          mirror?: boolean
          practice?: boolean
          score: number
          tier?: string | null
          tracked_at?: string | null
          watchlist?: boolean
        }
        Update: {
          address?: string
          base?: number | null
          cap?: number | null
          components?: Json | null
          computed_at?: string
          eligible?: boolean
          fast?: boolean
          filters?: Json | null
          mirror?: boolean
          practice?: boolean
          score?: number
          tier?: string | null
          tracked_at?: string | null
          watchlist?: boolean
        }
        Relationships: []
      }
      sm_trades: {
        Row: {
          address: string
          coin: string
          entry_px: number | null
          entry_t: string
          exit_px: number | null
          exit_t: string
          fees: number | null
          hold_h: number | null
          id: number
          liquidated: boolean
          max_notional: number | null
          net_pnl: number
          side: string
        }
        Insert: {
          address: string
          coin: string
          entry_px?: number | null
          entry_t: string
          exit_px?: number | null
          exit_t: string
          fees?: number | null
          hold_h?: number | null
          id?: number
          liquidated?: boolean
          max_notional?: number | null
          net_pnl: number
          side: string
        }
        Update: {
          address?: string
          coin?: string
          entry_px?: number | null
          entry_t?: string
          exit_px?: number | null
          exit_t?: string
          fees?: number | null
          hold_h?: number | null
          id?: number
          liquidated?: boolean
          max_notional?: number | null
          net_pnl?: number
          side?: string
        }
        Relationships: []
      }
      sm_wallet_stats: {
        Row: {
          account_value: number | null
          active_weeks: number | null
          address: string
          age_days: number | null
          avg_lev: number | null
          computed_at: string
          expectancy: number | null
          last_trade_at: string | null
          lifetime_pnl: number | null
          liquid_share: number | null
          liquidations: number | null
          max_lev: number | null
          mdd_180: number | null
          mdd_30: number | null
          mdd_90: number | null
          median_hold_h: number | null
          metrics: Json | null
          p25_hold_h: number | null
          portfolio: Json | null
          profit_factor: number | null
          ret_180: number | null
          ret_30: number | null
          ret_90: number | null
          top1_share: number | null
          top4_share: number | null
          trades: number | null
          win_loss: number | null
          win_rate: number | null
          wweeks_180: number | null
          wweeks_30: number | null
          wweeks_90: number | null
        }
        Insert: {
          account_value?: number | null
          active_weeks?: number | null
          address: string
          age_days?: number | null
          avg_lev?: number | null
          computed_at?: string
          expectancy?: number | null
          last_trade_at?: string | null
          lifetime_pnl?: number | null
          liquid_share?: number | null
          liquidations?: number | null
          max_lev?: number | null
          mdd_180?: number | null
          mdd_30?: number | null
          mdd_90?: number | null
          median_hold_h?: number | null
          metrics?: Json | null
          p25_hold_h?: number | null
          portfolio?: Json | null
          profit_factor?: number | null
          ret_180?: number | null
          ret_30?: number | null
          ret_90?: number | null
          top1_share?: number | null
          top4_share?: number | null
          trades?: number | null
          win_loss?: number | null
          win_rate?: number | null
          wweeks_180?: number | null
          wweeks_30?: number | null
          wweeks_90?: number | null
        }
        Update: {
          account_value?: number | null
          active_weeks?: number | null
          address?: string
          age_days?: number | null
          avg_lev?: number | null
          computed_at?: string
          expectancy?: number | null
          last_trade_at?: string | null
          lifetime_pnl?: number | null
          liquid_share?: number | null
          liquidations?: number | null
          max_lev?: number | null
          mdd_180?: number | null
          mdd_30?: number | null
          mdd_90?: number | null
          median_hold_h?: number | null
          metrics?: Json | null
          p25_hold_h?: number | null
          portfolio?: Json | null
          profit_factor?: number | null
          ret_180?: number | null
          ret_30?: number | null
          ret_90?: number | null
          top1_share?: number | null
          top4_share?: number | null
          trades?: number | null
          win_loss?: number | null
          win_rate?: number | null
          wweeks_180?: number | null
          wweeks_30?: number | null
          wweeks_90?: number | null
        }
        Relationships: []
      }
      sm_wallets: {
        Row: {
          account_value: number | null
          address: string
          display_name: string | null
          error: string | null
          first_seen: string
          invo_fills_60d: number
          invo_opens_60d: number
          invo_originator_share: number | null
          last_deep_dive_at: string | null
          lb_alltime_pnl: number | null
          lb_month_vlm: number | null
          next_due_at: string
          sources: string[]
          status: string
        }
        Insert: {
          account_value?: number | null
          address: string
          display_name?: string | null
          error?: string | null
          first_seen?: string
          invo_fills_60d?: number
          invo_opens_60d?: number
          invo_originator_share?: number | null
          last_deep_dive_at?: string | null
          lb_alltime_pnl?: number | null
          lb_month_vlm?: number | null
          next_due_at?: string
          sources?: string[]
          status?: string
        }
        Update: {
          account_value?: number | null
          address?: string
          display_name?: string | null
          error?: string | null
          first_seen?: string
          invo_fills_60d?: number
          invo_opens_60d?: number
          invo_originator_share?: number | null
          last_deep_dive_at?: string | null
          lb_alltime_pnl?: number | null
          lb_month_vlm?: number | null
          next_due_at?: string
          sources?: string[]
          status?: string
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
      cr_add_clip: {
        Args: { p: Json; p_campaign_id: string }
        Returns: {
          campaign_id: string
          created_at: string
          created_by_agent: string | null
          file_ref: string | null
          hook: string | null
          id: string
          qa_notes: string | null
          source_end_s: number | null
          source_start_s: number | null
          source_url: string | null
          stage: string
          updated_at: string
          value_layer: string | null
          variant: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cr_clips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cr_log_agent_run: {
        Args: {
          p_agent_key: string
          p_items: number
          p_next_run_at: string
          p_started_at: string
          p_status: string
          p_summary: string
        }
        Returns: {
          agent_key: string
          finished_at: string | null
          id: number
          items_processed: number
          started_at: string
          status: string
          summary: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cr_agent_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cr_record_post: {
        Args: { p: Json; p_clip_id: string }
        Returns: {
          account_id: string | null
          caption: string | null
          clip_id: string
          created_at: string
          denial_reason: string | null
          earning_window_ends_at: string | null
          est_earnings_usd: number
          id: string
          paid_usd: number
          payout_eta: string | null
          platform: string | null
          post_url: string
          posted_at: string | null
          submission_status: string
          updated_at: string
          views_24h: number | null
          views_72h: number | null
          views_7d: number | null
          views_current: number
          whop_submission_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cr_posts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cr_set_clip_stage: {
        Args: { p_clip_id: string; p_notes: string; p_stage: string }
        Returns: {
          campaign_id: string
          created_at: string
          created_by_agent: string | null
          file_ref: string | null
          hook: string | null
          id: string
          qa_notes: string | null
          source_end_s: number | null
          source_start_s: number | null
          source_url: string | null
          stage: string
          updated_at: string
          value_layer: string | null
          variant: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cr_clips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cr_update_post_metrics: {
        Args: { p: Json; p_post_id: string }
        Returns: {
          account_id: string | null
          caption: string | null
          clip_id: string
          created_at: string
          denial_reason: string | null
          earning_window_ends_at: string | null
          est_earnings_usd: number
          id: string
          paid_usd: number
          payout_eta: string | null
          platform: string | null
          post_url: string
          posted_at: string | null
          submission_status: string
          updated_at: string
          views_24h: number | null
          views_72h: number | null
          views_7d: number | null
          views_current: number
          whop_submission_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cr_posts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cr_upsert_campaign: {
        Args: { p: Json }
        Returns: {
          brand: string | null
          budget_remaining_usd: number | null
          budget_total_usd: number | null
          category: string
          created_at: string
          deadline: string | null
          disclosure_required: boolean
          flat_fee_usd: number | null
          id: string
          max_length_s: number | null
          max_payout_usd: number | null
          min_length_s: number | null
          min_payout_usd: number | null
          notes: string | null
          platforms: string[]
          prohibited: string | null
          rate_per_1k_usd: number | null
          red_flags: string[]
          required_credit: string | null
          required_hashtags: string[]
          score: number | null
          source_assets: string[]
          status: string
          title: string | null
          updated_at: string
          whop_url: string
        }
        SetofOptions: {
          from: "*"
          to: "cr_campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      hl_backtest_data: { Args: { p_coin: string }; Returns: Json }
      hl_latest_t: { Args: { p_coin: string }; Returns: Json }
      is_owner: { Args: never; Returns: boolean }
      live_lock: {
        Args: { p_owner: string; p_seconds: number }
        Returns: boolean
      }
      live_unlock: { Args: { p_owner: string }; Returns: undefined }
      sm_coin_hourly: { Args: { p_coin: string }; Returns: Json }
      sm_copy_coins: {
        Args: { p_min_trades: number }
        Returns: {
          coin: string
          trades: number
        }[]
      }
      sm_due_count: { Args: never; Returns: number }
      sm_due_wallets: {
        Args: { p_limit: number }
        Returns: {
          address: string
          first_seen: string
        }[]
      }
      sm_invo_agg: {
        Args: { p_since: string }
        Returns: {
          address: string
          fills: number
          opens: number
          originated: number
        }[]
      }
      sm_invo_agg2: {
        Args: { p_min: number; p_since: string }
        Returns: {
          address: string
          fills: number
          opens: number
          originated: number
        }[]
      }
      sm_latest_t: { Args: { p_coin: string }; Returns: Json }
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
          live_note: string | null
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
      take_weight: { Args: { p: number }; Returns: number }
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
