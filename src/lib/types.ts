export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      shows: {
        Row: {
          id: string;
          title: string;
          slug: string;
          poster_url: string | null;
          status: string | null;
          platform: string | null;
          synopsis: string | null;
          updated_at: string | null;
          tmdb_id: string | null;
        };
        Insert: ShowInsert;
        Update: Partial<ShowInsert>;
      };

      episodes: {
        Row: {
          id: string;
          show_id: string;
          season: number;
          episode: number;
          title: string;
          air_date: string | null;
          summary: string | null;
        };
        Insert: EpisodeInsert;
        Update: Partial<EpisodeInsert>;
      };

      user_shows: {
        Row: {
          id: string;
          user_id: string;
          show_id: string;
          collection: string | null;
          added_at: string | null;
        };
        Insert: UserShowInsert;
        Update: Partial<UserShowInsert>;
      };

      user_episodes: {
        Row: {
          id: string;
          user_id: string;
          episode_id: string;
          watched: boolean;
          watched_at: string | null;
        };
        Insert: UserEpisodeInsert;
        Update: Partial<UserEpisodeInsert>;
      };
    };
  };
}

// Insert type aliases
type ShowInsert = {
  id?: string;
  title: string;
  slug: string;
  poster_url?: string | null;
  status?: string | null;
  platform?: string | null;
  synopsis?: string | null;
  updated_at?: string | null;
  tmdb_id?: string | null;
};

type EpisodeInsert = {
  id?: string;
  show_id: string;
  season: number;
  episode: number;
  title: string;
  air_date?: string | null;
  summary?: string | null;
};

type UserShowInsert = {
  id?: string;
  user_id: string;
  show_id: string;
  collection?: string | null;
  added_at?: string | null;
};

type UserEpisodeInsert = {
  id?: string;
  user_id: string;
  episode_id: string;
  watched: boolean;
  watched_at?: string | null;
};

export type TMDBShow = {
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  first_air_date: string;
  status: string;
  homepage: string;
};