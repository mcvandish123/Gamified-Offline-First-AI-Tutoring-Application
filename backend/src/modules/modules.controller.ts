import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Headers,
} from '@nestjs/common';
import { ModulesService } from './modules.service';
import { SupabaseService } from '../supabase.service';

class SyncChatsDto {
  messages!: { role: string; content: string; created_at?: string }[];
}

class CreateModuleDto {
  title!: string;
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
}
