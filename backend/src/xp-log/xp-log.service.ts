import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class XpLogService {
  constructor(private supabase: SupabaseService) {}

  // Logs one XP-earning event and updates the user's running total + streak.
  // This is meant to be called internally by other services (flashcards,
  // progress, game sessions) right after a user does something XP-worthy —
  // not exposed as a route the frontend calls directly with a raw amount.
  async logXp(
    userId: string,
    xpEarned: number,
    source: 'flashcard' | 'quiz' | 'boss_battle',
  ) {
    const client = this.supabase.getClient();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // 1. Insert the log entry itself — this is what streak/chart queries read from
    const { data: logEntry, error: logError } = await client
      .from('daily_xp_log')
      .insert({
        user_id: userId,
        xp_earned: xpEarned,
        source,
        date: today,
      })
      .select()
      .single();

    if (logError) throw new BadRequestException(logError.message);

    // 2. Update the user's running total_xp and streak in user_progress
    const { data: progress, error: progressError } = await client
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (progressError) throw new BadRequestException(progressError.message);

    const newStreak = this.calculateStreak(
      progress.last_active_date,
      today,
      progress.current_streak,
    );

    // .select().single() here (instead of just firing the update) so we get
    // the fresh row back in the same round trip. The offline-sync client
    // needs this: when it pushes a queued flashcard/quiz answer that was
    // answered while offline, this is how it learns the *authoritative*
    // total_xp/streak to overwrite its local optimistic guess with —
    // without it, the client would need a second request just to ask
    // "ok, what's my real total now?"
    const { data: updatedProgress, error: updateError } = await client
      .from('user_progress')
      .update({
        total_xp: progress.total_xp + xpEarned,
        current_streak: newStreak,
        longest_streak: Math.max(newStreak, progress.longest_streak),
        last_active_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw new BadRequestException(updateError.message);

    return { success: true, logEntry, userProgress: updatedProgress };
  }

  // Compares the last active date to today to decide whether the streak
  // continues, resets, or stays the same (already studied today).
  private calculateStreak(
    lastActiveDate: string,
    today: string,
    currentStreak: number,
  ): number {
    if (lastActiveDate === today) {
      // Already logged activity today — streak doesn't change
      return currentStreak;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (lastActiveDate === yesterdayStr) {
      // Studied yesterday, studying again today — streak continues
      return currentStreak + 1;
    }

    // Gap of more than one day — streak resets to 1 (today counts as day one)
    return 1;
  }

  // Returns recent log entries for a user, used to render progress charts
  async getRecentForUser(userId: string, days: number = 30) {
    const client = this.supabase.getClient();

    // Calculate the cutoff date (e.g. 30 days ago) for the chart window
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const { data, error } = await client
      .from('daily_xp_log')
      .select('*')
      .eq('user_id', userId)
      .gte('date', cutoffStr)
      .order('date', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, log: data };
  }
}
