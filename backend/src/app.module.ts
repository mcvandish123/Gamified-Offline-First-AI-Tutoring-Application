import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ModulesModule } from './modules/modules.module';
import { ResourcesModule } from './resources/resources.module';
import { FlashcardsModule } from './flashcards/flashcards.module';
import { QuestionsModule } from './questions/questions.module';
import { AchievementsModule } from './achievements/achievements.module';
import { XpLogModule } from './xp-log/xp-log.module';
import { ProgressModule } from './progress/progress.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    ModulesModule,
    ResourcesModule,
    FlashcardsModule,
    QuestionsModule,
    AchievementsModule,
    XpLogModule,
    ProgressModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
