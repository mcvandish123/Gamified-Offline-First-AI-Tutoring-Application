import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class AchievementsService {
  constructor(private supabase: SupabaseService) {}

  async getAll() {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('achievements')
      .select('*')
      .order('condition_value', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, achievements: data };
  }

  async getUnlockedForUser(userId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('user_achievements')
      .select('*, achievements(*)')
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    return { success: true, achievements: data };
  }

  // Called internally after study/game sessions — not exposed as its own route
  async checkAchievements(userId: string) {
    const client = this.supabase.getClient();

    // 1. Get all achievement definitions
    const { data: allAchievements, error: achError } = await client
      .from('achievements')
      .select('*');

    if (achError) throw new BadRequestException(achError.message);

    // 2. Get achievements the user already has
    const { data: unlocked, error: unlockedError } = await client
      .from('user_achievements')
      .select('achievement_id')
      .eq('user_id', userId);

    if (unlockedError) throw new BadRequestException(unlockedError.message);

    const unlockedIds = new Set(unlocked.map((u) => u.achievement_id));
    const candidates = allAchievements.filter((a) => !unlockedIds.has(a.id));

    if (candidates.length === 0) return { success: true, newlyUnlocked: [] };

    // 3. Gather current stats needed to check conditions
    const { data: progress } = await client
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { count: modulesCompleted } = await client
      .from('module_progress')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_completed', true);

    const { count: bossesDefeated } = await client
      .from('game_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('boss_defeated', true);

    const stats: Record<string, number> = {
      streak: progress?.current_streak ?? 0,
      xp: progress?.total_xp ?? 0,
      modules_completed: modulesCompleted ?? 0,
      boss_defeated: bossesDefeated ?? 0,
    };

    // 4. Check each candidate's condition
    const newlyUnlocked: any[] = [];

    for (const achievement of candidates) {
      const statValue = stats[achievement.condition_type];
      if (statValue === undefined) continue; // unknown condition_type, skip safely

      if (statValue >= achievement.condition_value) {
        const { error: insertError } = await client
          .from('user_achievements')
          .insert({
            user_id: userId,
            achievement_id: achievement.id,
          });

        if (insertError) continue; // don't fail the whole batch over one row

        // Award the XP reward
        if (progress && achievement.xp_reward > 0) {
          await client
            .from('user_progress')
            .update({ total_xp: progress.total_xp + achievement.xp_reward })
            .eq('user_id', userId);
        }

        newlyUnlocked.push(achievement);
      }
    }

    return { success: true, newlyUnlocked };
  }
}
