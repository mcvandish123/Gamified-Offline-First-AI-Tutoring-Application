import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class ProgressService {
  constructor(private supabase: SupabaseService) {}

  async getForModule(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('module_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);

    // No progress yet means the user hasn't studied this module
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

    const { data: existing } = await client
      .from('module_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .maybeSingle();

    const isCompleted = masteryScore >= 1.0;

    if (existing) {
      const { data, error } = await client
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
      return { success: true, progress: data };
    }

    const { data, error } = await client
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
    return { success: true, progress: data };
  }
}
