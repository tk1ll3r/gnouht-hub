export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agent_nonces: {
        Row: {
          device_id: string
          nonce: string
          seen_at: string
        }
        Insert: {
          device_id: string
          nonce: string
          seen_at?: string
        }
        Update: {
          device_id?: string
          nonce?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_nonces_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          entity: string | null
          entity_id: string | null
          id: number
          ip: unknown
          meta: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          entity?: string | null
          entity_id?: string | null
          id?: never
          ip?: unknown
          meta?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          entity?: string | null
          entity_id?: string | null
          id?: never
          ip?: unknown
          meta?: Json
        }
        Relationships: []
      }
      briefs: {
        Row: {
          created_at: string
          for_date: string
          headline: string
          id: string
          kind: string
          markdown: string
          user_id: string
        }
        Insert: {
          created_at?: string
          for_date: string
          headline: string
          id?: string
          kind: string
          markdown: string
          user_id: string
        }
        Update: {
          created_at?: string
          for_date?: string
          headline?: string
          id?: string
          kind?: string
          markdown?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_sources: {
        Row: {
          account_label: string | null
          calendars: Json
          color: string
          created_at: string
          enabled: boolean
          flavor: string
          id: string
          kind: string
          last_error: string | null
          last_synced_at: string | null
          name: string
          scope: string | null
          status: string
          sync_state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          account_label?: string | null
          calendars?: Json
          color?: string
          created_at?: string
          enabled?: boolean
          flavor?: string
          id?: string
          kind: string
          last_error?: string | null
          last_synced_at?: string | null
          name: string
          scope?: string | null
          status?: string
          sync_state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          account_label?: string | null
          calendars?: Json
          color?: string
          created_at?: string
          enabled?: boolean
          flavor?: string
          id?: string
          kind?: string
          last_error?: string | null
          last_synced_at?: string | null
          name?: string
          scope?: string | null
          status?: string
          sync_state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checklist_items: {
        Row: {
          document_id: string
          first_seen_at: string
          id: number
          indent: number
          item_key: string
          line: number
          ord: number
          project_id: string
          section: string | null
          status: string
          status_changed_at: string
          text: string
          user_id: string
        }
        Insert: {
          document_id: string
          first_seen_at?: string
          id?: never
          indent?: number
          item_key: string
          line: number
          ord: number
          project_id: string
          section?: string | null
          status: string
          status_changed_at?: string
          text: string
          user_id: string
        }
        Update: {
          document_id?: string
          first_seen_at?: string
          id?: never
          indent?: number
          item_key?: string
          line?: number
          ord?: number
          project_id?: string
          section?: string | null
          status?: string
          status_changed_at?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_document_id_user_id_fkey"
            columns: ["document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "checklist_items_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      course_sessions: {
        Row: {
          course_id: string
          created_at: string
          end_time: string | null
          ends_on: string | null
          id: string
          kind: string
          period_end: number | null
          period_start: number | null
          room: string | null
          start_time: string | null
          starts_on: string | null
          updated_at: string
          user_id: string
          week_interval: number
          weekday: number
        }
        Insert: {
          course_id: string
          created_at?: string
          end_time?: string | null
          ends_on?: string | null
          id?: string
          kind?: string
          period_end?: number | null
          period_start?: number | null
          room?: string | null
          start_time?: string | null
          starts_on?: string | null
          updated_at?: string
          user_id?: string
          week_interval?: number
          weekday: number
        }
        Update: {
          course_id?: string
          created_at?: string
          end_time?: string | null
          ends_on?: string | null
          id?: string
          kind?: string
          period_end?: number | null
          period_start?: number | null
          room?: string | null
          start_time?: string | null
          starts_on?: string | null
          updated_at?: string
          user_id?: string
          week_interval?: number
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_sessions_course_id_user_id_fkey"
            columns: ["course_id", "user_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      courses: {
        Row: {
          class_code: string | null
          code: string
          color: string
          created_at: string
          credits: number | null
          id: string
          lecturer: string | null
          moodle_course_id: number | null
          name: string
          room: string | null
          semester_id: string
          source: string
          updated_at: string
          url: string | null
          user_id: string
          weight: number
        }
        Insert: {
          class_code?: string | null
          code: string
          color?: string
          created_at?: string
          credits?: number | null
          id?: string
          lecturer?: string | null
          moodle_course_id?: number | null
          name: string
          room?: string | null
          semester_id: string
          source?: string
          updated_at?: string
          url?: string | null
          user_id?: string
          weight?: number
        }
        Update: {
          class_code?: string | null
          code?: string
          color?: string
          created_at?: string
          credits?: number | null
          id?: string
          lecturer?: string | null
          moodle_course_id?: number | null
          name?: string
          room?: string | null
          semester_id?: string
          source?: string
          updated_at?: string
          url?: string | null
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "courses_semester_id_user_id_fkey"
            columns: ["semester_id", "user_id"]
            isOneToOne: false
            referencedRelation: "semesters"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      device_pairing_codes: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      devices: {
        Row: {
          agent_version: string | null
          created_at: string
          id: string
          last_seen_at: string | null
          name: string
          platform: string | null
          secret_ciphertext: string
          status: Json
          user_id: string
        }
        Insert: {
          agent_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name: string
          platform?: string | null
          secret_ciphertext: string
          status?: Json
          user_id: string
        }
        Update: {
          agent_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          platform?: string | null
          secret_ciphertext?: string
          status?: Json
          user_id?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          content: string
          document_id: string
          fts: unknown
          heading: string | null
          id: number
          line: number
          ord: number
          project_id: string
          user_id: string
        }
        Insert: {
          content: string
          document_id: string
          fts?: unknown
          heading?: string | null
          id?: never
          line?: number
          ord: number
          project_id: string
          user_id: string
        }
        Update: {
          content?: string
          document_id?: string
          fts?: unknown
          heading?: string | null
          id?: never
          line?: number
          ord?: number
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_user_id_fkey"
            columns: ["document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "document_chunks_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean
          busy: boolean
          calendar_id: string | null
          ends_at: string
          external_id: string
          id: string
          location: string | null
          source_id: string
          starts_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          busy?: boolean
          calendar_id?: string | null
          ends_at: string
          external_id: string
          id?: string
          location?: string | null
          source_id: string
          starts_at: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          busy?: boolean
          calendar_id?: string | null
          ends_at?: string
          external_id?: string
          id?: string
          location?: string | null
          source_id?: string
          starts_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_source_id_user_id_fkey"
            columns: ["source_id", "user_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      group_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          group_id: string
          id: string
          invited_by: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          group_id: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          group_id?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          role: string
          share_busy: boolean
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          role?: string
          share_busy?: boolean
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          role?: string
          share_busy?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_secrets: {
        Row: {
          ciphertext: string
          key_version: number
          source_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ciphertext: string
          key_version?: number
          source_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ciphertext?: string
          key_version?: number
          source_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_secrets_source_id_user_id_fkey"
            columns: ["source_id", "user_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      manual_quotas: {
        Row: {
          id: string
          limit_value: number
          name: string
          resets_on: string | null
          unit: string
          updated_at: string
          used: number
          user_id: string
        }
        Insert: {
          id?: string
          limit_value: number
          name: string
          resets_on?: string | null
          unit?: string
          updated_at?: string
          used?: number
          user_id?: string
        }
        Update: {
          id?: string
          limit_value?: number
          name?: string
          resets_on?: string | null
          unit?: string
          updated_at?: string
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ai_consent_at: string | null
          busy_buffer_minutes: number
          created_at: string
          day_end: string
          day_start: string
          display_name: string
          email_digest: boolean
          id: string
          period_times: Json
          timezone: string
          updated_at: string
        }
        Insert: {
          ai_consent_at?: string | null
          busy_buffer_minutes?: number
          created_at?: string
          day_end?: string
          day_start?: string
          display_name?: string
          email_digest?: boolean
          id: string
          period_times?: Json
          timezone?: string
          updated_at?: string
        }
        Update: {
          ai_consent_at?: string | null
          busy_buffer_minutes?: number
          created_at?: string
          day_end?: string
          day_start?: string
          display_name?: string
          email_digest?: boolean
          id?: string
          period_times?: Json
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_documents: {
        Row: {
          content: string
          content_hash: string
          error: string | null
          id: string
          indexed_at: string
          items_attention: number
          items_cut: number
          items_doing: number
          items_done: number
          items_total: number
          kind: string
          modified_at: string | null
          path: string
          project_id: string
          redactions: number
          reference_date: string | null
          size_bytes: number
          title: string
          truncated: boolean
          user_id: string
        }
        Insert: {
          content?: string
          content_hash: string
          error?: string | null
          id?: string
          indexed_at?: string
          items_attention?: number
          items_cut?: number
          items_doing?: number
          items_done?: number
          items_total?: number
          kind: string
          modified_at?: string | null
          path: string
          project_id: string
          redactions?: number
          reference_date?: string | null
          size_bytes?: number
          title: string
          truncated?: boolean
          user_id: string
        }
        Update: {
          content?: string
          content_hash?: string
          error?: string | null
          id?: string
          indexed_at?: string
          items_attention?: number
          items_cut?: number
          items_doing?: number
          items_done?: number
          items_total?: number
          kind?: string
          modified_at?: string | null
          path?: string
          project_id?: string
          redactions?: number
          reference_date?: string | null
          size_bytes?: number
          title?: string
          truncated?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      project_progress_daily: {
        Row: {
          attention: number
          cut: number
          day: string
          doing: number
          done: number
          project_id: string
          total: number
          user_id: string
        }
        Insert: {
          attention: number
          cut: number
          day: string
          doing: number
          done: number
          project_id: string
          total: number
          user_id: string
        }
        Update: {
          attention?: number
          cut?: number
          day?: string
          doing?: number
          done?: number
          project_id?: string
          total?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_progress_daily_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      project_shares: {
        Row: {
          created_at: string
          group_id: string
          project_id: string
          shared_by: string
        }
        Insert: {
          created_at?: string
          group_id: string
          project_id: string
          shared_by?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          project_id?: string
          shared_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_shares_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_shares_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          color: string
          course_id: string | null
          created_at: string
          description: string | null
          device_id: string | null
          due_on: string | null
          folder_key: string | null
          folder_label: string | null
          id: string
          items_attention: number
          items_cut: number
          items_doing: number
          items_done: number
          items_total: number
          last_synced_at: string | null
          name: string
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          course_id?: string | null
          created_at?: string
          description?: string | null
          device_id?: string | null
          due_on?: string | null
          folder_key?: string | null
          folder_label?: string | null
          id?: string
          items_attention?: number
          items_cut?: number
          items_doing?: number
          items_done?: number
          items_total?: number
          last_synced_at?: string | null
          name: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          color?: string
          course_id?: string | null
          created_at?: string
          description?: string | null
          device_id?: string | null
          due_on?: string | null
          folder_key?: string | null
          folder_label?: string | null
          id?: string
          items_attention?: number
          items_cut?: number
          items_doing?: number
          items_done?: number
          items_total?: number
          last_synced_at?: string | null
          name?: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_course_id_user_id_fkey"
            columns: ["course_id", "user_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "projects_device_id_user_id_fkey"
            columns: ["device_id", "user_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      quota_snapshots: {
        Row: {
          account_label: string
          captured_at: string
          connection_id: string
          device_id: string
          id: number
          plan: string | null
          provider: string
          remaining_pct: number | null
          reset_at: string | null
          total: number | null
          unlimited: boolean
          used: number | null
          user_id: string
          window_label: string
        }
        Insert: {
          account_label: string
          captured_at: string
          connection_id: string
          device_id: string
          id?: never
          plan?: string | null
          provider: string
          remaining_pct?: number | null
          reset_at?: string | null
          total?: number | null
          unlimited?: boolean
          used?: number | null
          user_id: string
          window_label: string
        }
        Update: {
          account_label?: string
          captured_at?: string
          connection_id?: string
          device_id?: string
          id?: never
          plan?: string | null
          provider?: string
          remaining_pct?: number | null
          reset_at?: string | null
          total?: number | null
          unlimited?: boolean
          used?: number | null
          user_id?: string
          window_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "quota_snapshots_device_id_user_id_fkey"
            columns: ["device_id", "user_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          hits: number
          window_start: string
        }
        Insert: {
          bucket: string
          hits: number
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          window_start?: string
        }
        Relationships: []
      }
      semesters: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          is_current: boolean
          name: string
          skip_dates: string[]
          starts_on: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          is_current?: boolean
          name: string
          skip_dates?: string[]
          starts_on: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          is_current?: boolean
          name?: string
          skip_dates?: string[]
          starts_on?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      signup_allowlist: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed_at: string | null
          course_id: string | null
          created_at: string
          document_id: string | null
          due_at: string | null
          estimate_hours: number | null
          id: string
          kind: string
          notes: string | null
          progress: number
          project_id: string | null
          source: string
          source_key: string | null
          source_ref: Json
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          document_id?: string | null
          due_at?: string | null
          estimate_hours?: number | null
          id?: string
          kind?: string
          notes?: string | null
          progress?: number
          project_id?: string | null
          source?: string
          source_key?: string | null
          source_ref?: Json
          status?: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          document_id?: string | null
          due_at?: string | null
          estimate_hours?: number | null
          id?: string
          kind?: string
          notes?: string | null
          progress?: number
          project_id?: string | null
          source?: string
          source_key?: string | null
          source_ref?: Json
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_course_id_user_id_fkey"
            columns: ["course_id", "user_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_document_fk"
            columns: ["document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_project_fk"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      usage_daily: {
        Row: {
          cost_usd: number
          day: string
          input_tokens: number
          model: string
          output_tokens: number
          provider: string
          requests: number
          user_id: string
        }
        Insert: {
          cost_usd?: number
          day: string
          input_tokens?: number
          model: string
          output_tokens?: number
          provider: string
          requests?: number
          user_id: string
        }
        Update: {
          cost_usd?: number
          day?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          provider?: string
          requests?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      quota_latest: {
        Row: {
          account_label: string | null
          captured_at: string | null
          connection_id: string | null
          device_id: string | null
          id: number | null
          plan: string | null
          provider: string | null
          remaining_pct: number | null
          reset_at: string | null
          total: number | null
          unlimited: boolean | null
          used: number | null
          user_id: string | null
          window_label: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quota_snapshots_device_id_user_id_fkey"
            columns: ["device_id", "user_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
    }
    Functions: {
      accept_group_invite: { Args: { p_invite: string }; Returns: string }
      create_group: {
        Args: { p_color?: string; p_description?: string; p_name: string }
        Returns: string
      }
      create_group_invite: {
        Args: { p_days?: number; p_email: string; p_group: string }
        Returns: string
      }
      group_roster: {
        Args: { p_group: string }
        Returns: {
          display_name: string
          joined_at: string
          role: string
          share_busy: boolean
          user_id: string
        }[]
      }
      hit_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      ingest_document: {
        Args: {
          p_chunks: Json
          p_deadlines: Json
          p_document: Json
          p_items: Json
          p_project: string
        }
        Returns: string
      }
      refresh_project_stats: { Args: { p_project: string }; Returns: undefined }
      search_documents: {
        Args: { p_limit?: number; p_project?: string; p_query: string }
        Returns: {
          chunk_id: number
          content: string
          document_id: string
          heading: string
          line: number
          project_id: string
          rank: number
        }[]
      }
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

