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
          due_at: string | null
          estimate_hours: number | null
          id: string
          kind: string
          notes: string | null
          progress: number
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
          due_at?: string | null
          estimate_hours?: number | null
          id?: string
          kind?: string
          notes?: string | null
          progress?: number
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
          due_at?: string | null
          estimate_hours?: number | null
          id?: string
          kind?: string
          notes?: string | null
          progress?: number
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
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

