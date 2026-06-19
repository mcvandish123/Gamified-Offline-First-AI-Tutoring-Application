import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AchievementsService } from '../achievements/achievements.service';
import { XpLogService } from '../xp-log/xp-log.service';

@Injectable()
export class ProgressService {
  constructor(
    private supabase: SupabaseService,
    private achievements: AchievementsService,
    private xpLog: XpLogService, // new dependency for logging XP
  ) {}

  async getForModule(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('module_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);

    // No row yet means the user hasn't studied this module at all
    if (!data) {
      return {
        success: true,
        progress: {
          mastery_score: 0.0,
          times_reviewed: 0,
          is_completed: false,
        },
      };
    }

    return { success: true, progress: data };
  }

  async updateProgress(userId: string, moduleId: string, masteryScore: number) {
    const client = this.supabase.getClient();

    // Check if a progress row already exists for this user + module
    const { data: existing } = await client
      .from('module_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .maybeSingle();

    const isCompleted = masteryScore >= 1.0;
    // Track whether this update is the moment the module FIRST became completed,
    // so we only award the "completion bonus" XP once, not every time mastery updates
    const wasAlreadyCompleted = existing?.is_completed ?? false;

    let data;

    if (existing) {
      // Progress row exists — update mastery score and review count
      const { data: updated, error } = await client
        .from('module_progress')
        .update({
          mastery_score: masteryScore,
          times_reviewed: existing.times_reviewed + 1,
          is_completed: isCompleted,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw new BadRequestException(error.message);
      data = updated;
    } else {
      // First time studying this module — create the progress row
      const { data: created, error } = await client
        .from('module_progress')
        .insert({
          user_id: userId,
          module_id: moduleId,
          mastery_score: masteryScore,
          times_reviewed: 1,
          is_completed: isCompleted,
        })
        .select()
        .single();

      if (error) throw new BadRequestException(error.message);
      data = created;
    }

    // Award a one-time completion bonus only on the transition from
    // "not completed" to "completed" — repeated re-studies after
    // mastery is already 1.0 won't keep awarding this bonus
    if (isCompleted && !wasAlreadyCompleted) {
      await this.xpLog.logXp(userId, 50, 'quiz'); // 50 XP for completing a module
    }

    // Check if this update unlocked any achievements
    await this.achievements.checkAchievements(userId);

    return { success: true, progress: data };
  }
}
