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
      activity: {
        Row: {
          actor_id: string | null
          at: string
          id: number
          project_id: string
          subject: string | null
          verb: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          id?: never
          project_id: string
          subject?: string | null
          verb: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          id?: never
          project_id?: string
          subject?: string | null
          verb?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
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
          idx: number
          tsv: unknown
        }
        Insert: {
          content: string
          document_id: string
          idx: number
          tsv?: unknown
        }
        Update: {
          content?: string
          document_id?: string
          idx?: number
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          checklist: Json | null
          device_id: string
          excerpt: string | null
          ext: string
          id: string
          indexed_at: string
          modified_at: string
          owner_id: string
          path: string
          project_id: string | null
          sha256: string
          size_bytes: number
          storage_path: string | null
          summary: string | null
          title: string
          visibility: string
        }
        Insert: {
          checklist?: Json | null
          device_id: string
          excerpt?: string | null
          ext: string
          id?: string
          indexed_at?: string
          modified_at: string
          owner_id: string
          path: string
          project_id?: string | null
          sha256: string
          size_bytes: number
          storage_path?: string | null
          summary?: string | null
          title: string
          visibility?: string
        }
        Update: {
          checklist?: Json | null
          device_id?: string
          excerpt?: string | null
          ext?: string
          id?: string
          indexed_at?: string
          modified_at?: string
          owner_id?: string
          path?: string
          project_id?: string | null
          sha256?: string
          size_bytes?: number
          storage_path?: string | null
          summary?: string | null
          title?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_device_id_owner_id_fkey"
            columns: ["device_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
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
      milestones: {
        Row: {
          created_at: string
          done: boolean
          due_on: string
          hard: boolean
          id: string
          project_id: string
          source: string
          source_key: string | null
          source_ref: Json
          starts_on: string | null
          title: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          due_on: string
          hard?: boolean
          id?: string
          project_id: string
          source?: string
          source_key?: string | null
          source_ref?: Json
          starts_on?: string | null
          title: string
        }
        Update: {
          created_at?: string
          done?: boolean
          due_on?: string
          hard?: boolean
          id?: string
          project_id?: string
          source?: string
          source_key?: string | null
          source_ref?: Json
          starts_on?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      project_members: {
        Row: {
          joined_at: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          joined_at?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
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
          due_on: string | null
          id: string
          kind: string
          name: string
          owner_id: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          color?: string
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_on?: string | null
          id?: string
          kind?: string
          name: string
          owner_id?: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          color?: string
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_on?: string | null
          id?: string
          kind?: string
          name?: string
          owner_id?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
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
          assignee_id: string | null
          completed_at: string | null
          course_id: string | null
          created_at: string
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
          assignee_id?: string | null
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
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
          assignee_id?: string | null
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
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
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
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
      hit_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      search_documents: {
        Args: { p_limit?: number; p_project?: string; q: string }
        Returns: {
          document_id: string
          ext: string
          modified_at: string
          path: string
          project_id: string
          rank: number
          snippet: string
          title: string
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

