import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { randomUUID } from 'crypto';

@Injectable()
export class ModulesService {
  private groq: Groq;

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService,
  ) {
    this.groq = new Groq({ apiKey: this.config.get('GROQ_API_KEY') });
  }

  async getAllForUser(userId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('modules')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    // Attach a chat_count to each module — derived from module_chats,
    // since modules itself doesn't store a count column.
    const moduleIds = (data ?? []).map((m) => m.id);

    if (moduleIds.length === 0) {
      return { success: true, modules: [] };
    }

    const { data: chatRows, error: chatError } = await client
      .from('module_chats')
      .select('module_id')
      .in('module_id', moduleIds);

    if (chatError) throw new BadRequestException(chatError.message);

    const countsByModule: Record<string, number> = {};
    for (const row of chatRows ?? []) {
      countsByModule[row.module_id] = (countsByModule[row.module_id] ?? 0) + 1;
    }

    const modulesWithCounts = (data ?? []).map((mod) => ({
      ...mod,
      chat_count: countsByModule[mod.id] ?? 0,
    }));

    return { success: true, modules: modulesWithCounts };
  }

  async createModule(userId: string, title: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('modules')
      .insert({
        user_id: userId,
        resource_id: null,
        title,
        summary: null,
        key_terms: null,
        difficulty: 'easy',
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, module: { ...data, chat_count: 0 } };
  }

  async deleteModule(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { error } = await client
      .from('modules')
      .delete()
      .eq('id', moduleId)
      .eq('user_id', userId);

    if (error) throw new BadRequestException(error.message);

    return { success: true, message: 'Module deleted' };
  }

  async getOne(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('modules')
      .select('*')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, module: data };
  }

  // Chats
  async getChats(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('module_chats')
      .select('*')
      .eq('module_id', moduleId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, chats: data };
  }

  async syncChats(
    userId: string,
    moduleId: string,
    messages: {
      role: string;
      content: string;
      conversation_id: string;
      created_at?: string;
    }[],
  ) {
    const client = this.supabase.getClient();

    const rows = messages.map((m) => ({
      module_id: moduleId,
      conversation_id: m.conversation_id,
      user_id: userId,
      role: m.role,
      content: m.content,
      created_at: m.created_at ?? new Date().toISOString(),
    }));

    const { data, error } = await client
      .from('module_chats')
      .insert(rows)
      .select();

    if (error) throw new BadRequestException(error.message);

    // Asynchronously trigger Groq chatbot response generation for user messages that don't have assistant responses yet.
    for (const msg of messages) {
      if (msg.role === 'user') {
        this.generateAssistantReplyInBackground(
          userId,
          moduleId,
          msg.conversation_id,
        ).catch((err) =>
          console.error(
            'Error generating background AI reply during sync:',
            err,
          ),
        );
      }
    }

    return { success: true, synced: data };
  }

  // Conversations — named chat threads within a module, shown on the
  // "Recent Conversations" list (Library → Notebook → Chats tab).
  async getConversations(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    const { data: conversations, error } = await client
      .from('conversations')
      .select('*')
      .eq('module_id', moduleId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    const conversationIds = (conversations ?? []).map((c) => c.id);

    if (conversationIds.length === 0) {
      return { success: true, conversations: [] };
    }

    // Pull every message for these conversations once, then derive each
    // conversation's preview (last message) and message count in memory —
    // cheaper than N round trips, one per conversation.
    const { data: messages, error: msgError } = await client
      .from('module_chats')
      .select('conversation_id, role, content, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true });

    if (msgError) throw new BadRequestException(msgError.message);

    const lastMessageByConv: Record<
      string,
      { content: string; created_at: string }
    > = {};
    const countByConv: Record<string, number> = {};

    for (const m of messages ?? []) {
      countByConv[m.conversation_id] =
        (countByConv[m.conversation_id] ?? 0) + 1;
      // messages are ascending, so the last one we see per conversation
      // is naturally the most recent — no extra sort needed.
      lastMessageByConv[m.conversation_id] = {
        content: m.content,
        created_at: m.created_at,
      };
    }

    const enriched = (conversations ?? []).map((c) => ({
      ...c,
      message_count: countByConv[c.id] ?? 0,
      last_message: lastMessageByConv[c.id]?.content ?? null,
      last_message_at: lastMessageByConv[c.id]?.created_at ?? c.created_at,
    }));

    return { success: true, conversations: enriched };
  }

  async createConversation(userId: string, moduleId: string, title: string) {
    const client = this.supabase.getClient();

    const now = new Date().toISOString();

    const { data, error } = await client
      .from('conversations')
      .insert({
        module_id: moduleId,
        user_id: userId,
        title,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, conversation: data };
  }

  async getConversationMessages(
    userId: string,
    moduleId: string,
    conversationId: string,
  ) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('module_chats')
      .select('*')
      .eq('module_id', moduleId)
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, messages: data };
  }

  async sendMessageAndGetResponse(
    userId: string,
    moduleId: string,
    conversationId: string,
    messageId: string,
    content: string,
  ) {
    const client = this.supabase.getClient();

    // 1. Insert user message
    const now = new Date().toISOString();
    const { data: userMessageRaw, error: userError } = await client
      .from('module_chats')
      .insert({
        id: messageId,
        module_id: moduleId,
        conversation_id: conversationId,
        user_id: userId,
        role: 'user',
        content: content,
        created_at: now,
      })
      .select()
      .single();

    if (userError) throw new BadRequestException(userError.message);
    const userMessage = userMessageRaw as unknown as Record<string, any>;

    // 2. Fetch context
    const { data: moduleDataRaw } = await client
      .from('modules')
      .select('*')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();
    const moduleData = moduleDataRaw as unknown as {
      title: string;
      summary: string | null;
      key_terms: any;
      resource_id: string | null;
    } | null;

    let resourceText = '';
    if (moduleData && moduleData.resource_id) {
      const { data: resDataRaw } = await client
        .from('resources')
        .select('raw_text')
        .eq('id', moduleData.resource_id)
        .single();
      const resData = resDataRaw;
      if (resData) {
        resourceText = resData.raw_text || '';
      }
    }

    // 3. Fetch conversation history (last 20 messages for context)
    const { data: historyRaw } = await client
      .from('module_chats')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);
    const history = (historyRaw || []) as unknown as {
      role: string;
      content: string;
    }[];

    // 4. Construct system prompt
    const systemPrompt = `You are a gamified, supportive AI tutor. Your goal is to help the user learn the material in this module.
Module Title: ${moduleData?.title || 'Unknown Module'}
${moduleData?.summary ? `Module Summary: ${moduleData.summary}` : ''}
${moduleData?.key_terms ? `Key Terms: ${JSON.stringify(moduleData.key_terms)}` : ''}
${resourceText ? `Extracted Learning Material (PDF):\n${resourceText.substring(0, 4000)}...` : ''}

Guidelines:
- Be encouraging, conversational, and tutoring-oriented.
- Do NOT just give the answers immediately! Ask guiding, interactive questions to help the user arrive at the answer themselves.
- Use emojis, formatting, and markdown list items to make the chat feel interactive, fun, and easy to read.
- Keep answers clear, bite-sized, and highly structured.
- If the user asks about topics outside this module's scope, guide them back politely to the topic of the module.`;

    // 5. Call Groq
    let assistantReply =
      'I apologize, but I am unable to generate a response at this moment.';
    const modelToUse = 'llama-3.3-70b-versatile';
    const fallbackModel = 'llama-3.1-8b-instant';

    try {
      const completion = await this.groq.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
        ],
      });
      assistantReply =
        completion.choices[0]?.message?.content || assistantReply;
    } catch (error) {
      console.warn(
        `Failed to call primary model ${modelToUse}, trying fallback.`,
        error,
      );
      try {
        const completion = await this.groq.chat.completions.create({
          model: fallbackModel,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
            })),
          ],
        });
        assistantReply =
          completion.choices[0]?.message?.content || assistantReply;
      } catch (fallbackError) {
        console.error('Groq API calls failed entirely.', fallbackError);
        assistantReply =
          'I apologize, but my AI tutoring brain is currently offline. Please check your Groq API key setup or try again later!';
      }
    }

    // 6. Insert assistant reply
    const assistantMessageId = randomUUID();
    const assistantCreatedAt = new Date().toISOString();
    const { data: assistantMessageRaw, error: assistantError } = await client
      .from('module_chats')
      .insert({
        id: assistantMessageId,
        module_id: moduleId,
        conversation_id: conversationId,
        user_id: userId,
        role: 'assistant',
        content: assistantReply,
        created_at: assistantCreatedAt,
      })
      .select()
      .single();

    if (assistantError) throw new BadRequestException(assistantError.message);
    const assistantMessage = assistantMessageRaw as unknown as Record<
      string,
      any
    >;

    // 7. Update parent conversation's updated_at timestamp to reflect new activity
    await client
      .from('conversations')
      .update({ updated_at: assistantCreatedAt })
      .eq('id', conversationId);

    return {
      success: true,
      userMessage,
      assistantMessage,
    };
  }

  async generateAssistantReplyInBackground(
    userId: string,
    moduleId: string,
    conversationId: string,
  ) {
    const client = this.supabase.getClient();

    // 1. Check if the latest message is from the user (if so, we need an assistant response)
    const { data: lastMessagesRaw, error: lastError } = await client
      .from('module_chats')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (lastError || !lastMessagesRaw || lastMessagesRaw.length === 0) return;
    const lastMessages = lastMessagesRaw as unknown as { role: string }[];
    if (lastMessages[0].role !== 'user') return; // Assistant already responded or no user message

    // 2. Fetch context
    const { data: moduleDataRaw } = await client
      .from('modules')
      .select('*')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();
    const moduleData = moduleDataRaw as unknown as {
      title: string;
      summary: string | null;
      key_terms: any;
      resource_id: string | null;
    } | null;

    let resourceText = '';
    if (moduleData && moduleData.resource_id) {
      const { data: resDataRaw } = await client
        .from('resources')
        .select('raw_text')
        .eq('id', moduleData.resource_id)
        .single();
      const resData = resDataRaw;
      if (resData) {
        resourceText = resData.raw_text || '';
      }
    }

    // 3. Fetch conversation history (last 20 messages for context)
    const { data: historyRaw } = await client
      .from('module_chats')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);
    const history = (historyRaw || []) as unknown as {
      role: string;
      content: string;
    }[];

    // 4. Construct system prompt
    const systemPrompt = `You are a gamified, supportive AI tutor. Your goal is to help the user learn the material in this module.
Module Title: ${moduleData?.title || 'Unknown Module'}
${moduleData?.summary ? `Module Summary: ${moduleData.summary}` : ''}
${moduleData?.key_terms ? `Key Terms: ${JSON.stringify(moduleData.key_terms)}` : ''}
${resourceText ? `Extracted Learning Material (PDF):\n${resourceText.substring(0, 4000)}...` : ''}

Guidelines:
- Be encouraging, conversational, and tutoring-oriented.
- Do NOT just give the answers immediately! Ask guiding, interactive questions to help the user arrive at the answer themselves.
- Use emojis, formatting, and markdown list items to make the chat feel interactive, fun, and easy to read.
- Keep answers clear, bite-sized, and highly structured.
- If the user asks about topics outside this module's scope, guide them back politely to the topic of the module.`;

    // 5. Call Groq
    let assistantReply =
      'I apologize, but I am unable to generate a response at this moment.';
    const modelToUse = 'llama-3.3-70b-versatile';
    const fallbackModel = 'llama-3.1-8b-instant';

    try {
      const completion = await this.groq.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
        ],
      });
      assistantReply =
        completion.choices[0]?.message?.content || assistantReply;
    } catch (error) {
      console.warn(
        `Failed to call primary model ${modelToUse} in background, trying fallback.`,
        error,
      );
      try {
        const completion = await this.groq.chat.completions.create({
          model: fallbackModel,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
            })),
          ],
        });
        assistantReply =
          completion.choices[0]?.message?.content || assistantReply;
      } catch (fallbackError) {
        console.error(
          'Groq background API calls failed entirely.',
          fallbackError,
        );
        return; // don't insert a generic error message in background to avoid spamming database
      }
    }

    // 6. Insert assistant reply
    const assistantMessageId = randomUUID();
    const assistantCreatedAt = new Date().toISOString();
    await client.from('module_chats').insert({
      id: assistantMessageId,
      module_id: moduleId,
      conversation_id: conversationId,
      user_id: userId,
      role: 'assistant',
      content: assistantReply,
      created_at: assistantCreatedAt,
    });

    // 7. Update parent conversation's updated_at timestamp to reflect new activity
    await client
      .from('conversations')
      .update({ updated_at: assistantCreatedAt })
      .eq('id', conversationId);
  }
}
