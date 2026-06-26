import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Headers,
} from '@nestjs/common';
import { ModulesService } from './modules.service';
import { SupabaseService } from '../supabase.service';

class SyncChatsDto {
  messages!: {
    role: string;
    content: string;
    conversation_id: string;
    created_at?: string;
  }[];
}

class CreateModuleDto {
  title!: string;
}

class CreateConversationDto {
  title!: string;
}

class AskQuestionDto {
  messageId!: string;
  content!: string;
}

class AddSourceDto {
  resourceId!: string;
}

@Controller('modules')
export class ModulesController {
  constructor(
    private modulesService: ModulesService,
    private supabase: SupabaseService,
  ) {}

  private async getUserId(authorization: string): Promise<string> {
    const token = authorization?.replace('Bearer ', '');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error) throw new Error('Unauthorized');
    return data.user.id;
  }

  @Get()
  async getAll(@Headers('authorization') authorization: string) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.getAllForUser(userId);
  }

  @Post()
  async create(
    @Headers('authorization') authorization: string,
    @Body() body: CreateModuleDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.createModule(userId, body.title);
  }

  @Delete(':id')
  async remove(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.deleteModule(userId, id);
  }

  @Patch(':id')
  async update(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
    @Body() body: CreateModuleDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.updateModule(userId, id, body.title);
  }

  @Get(':id')
  async getOne(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.getOne(userId, id);
  }

  @Get(':id/chats')
  async getChats(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.getChats(userId, id);
  }

  @Post(':id/chats')
  async syncChats(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
    @Body() body: SyncChatsDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.syncChats(userId, id, body.messages);
  }

  @Get(':id/conversations')
  async getConversations(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.getConversations(userId, id);
  }

  @Post(':id/conversations')
  async createConversation(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
    @Body() body: CreateConversationDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.createConversation(userId, id, body.title);
  }

  @Get(':id/conversations/:conversationId/messages')
  async getConversationMessages(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.getConversationMessages(
      userId,
      id,
      conversationId,
    );
  }

  @Post(':id/conversations/:conversationId/messages')
  async sendMessage(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
    @Body() body: AskQuestionDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.sendMessageAndGetResponse(
      userId,
      id,
      conversationId,
      body.messageId,
      body.content,
    );
  }

  @Get(':id/conversations/:conversationId/sources')
  async getConversationSources(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.getConversationSources(
      userId,
      id,
      conversationId,
    );
  }

  @Post(':id/conversations/:conversationId/sources')
  async addConversationSource(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
    @Body() body: AddSourceDto,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.addConversationSource(
      userId,
      id,
      conversationId,
      body.resourceId,
    );
  }

  @Delete(':id/conversations/:conversationId/sources/:resourceId')
  async removeConversationSource(
    @Headers('authorization') authorization: string,
    @Param('conversationId') conversationId: string,
    @Param('resourceId') resourceId: string,
  ) {
    const userId = await this.getUserId(authorization);
    return this.modulesService.removeConversationSource(
      userId,
      conversationId,
      resourceId,
    );
  }
}
