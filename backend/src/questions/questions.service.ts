import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class QuestionsService {
  constructor(private supabase: SupabaseService) {}

  async getForModule(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    // Verify the module belongs to this user
    const { data: module, error: moduleError } = await client
      .from('modules')
      .select('id')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();

    if (moduleError) throw new BadRequestException('Module not found');

    const { data, error } = await client
      .from('questions')
      .select('*')
      .eq('module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, questions: data };
  }

  async getOne(userId: string, questionId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('questions')
      .select('*, modules!inner(user_id)')
      .eq('id', questionId)
      .eq('modules.user_id', userId)
      .single();

    if (error) throw new BadRequestException('Question not found');

    return { success: true, question: data };
  }
}
