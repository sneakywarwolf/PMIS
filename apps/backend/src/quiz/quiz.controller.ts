import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { QuizService } from './quiz.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateQuizQuestionDto } from './dto/create-quiz-question.dto';
import { UpdateQuizQuestionDto } from './dto/update-quiz-question.dto';
import { AnswerQuizQuestionDto } from './dto/answer-quiz-question.dto';

@Controller('quiz')
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  @Get('today')
  getToday(@CurrentUser('id') userId: string) {
    return this.quiz.getTodayQuestion(userId);
  }

  @Post('today/answer')
  answerToday(@CurrentUser('id') userId: string, @Body() dto: AnswerQuizQuestionDto) {
    return this.quiz.submitAnswer(userId, dto.questionId, dto.selectedOption);
  }

  @Get('log')
  getLog(@Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20) {
    return this.quiz.getLog(page, pageSize);
  }

  @Get('log/:id')
  getLogEntry(@Param('id') id: string) {
    return this.quiz.getLogEntry(id);
  }

  @Get('scorecard')
  getScorecard(@CurrentUser('id') userId: string) {
    return this.quiz.getScorecard(userId);
  }

  @Get('scorecard/leaderboard')
  getLeaderboard() {
    return this.quiz.getLeaderboard();
  }

  @Roles(UserRole.ADMIN)
  @Post('questions')
  createQuestion(@CurrentUser('id') userId: string, @Body() dto: CreateQuizQuestionDto, @Req() req: any) {
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.quiz.createQuestion(userId, dto, ipAddress, userAgent);
  }

  @Roles(UserRole.ADMIN)
  @Put('questions/:id')
  updateQuestion(@Param('id') id: string, @Body() dto: UpdateQuizQuestionDto, @CurrentUser('id') userId: string, @Req() req: any) {
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.quiz.updateQuestion(id, dto, userId, ipAddress, userAgent);
  }

  @Roles(UserRole.ADMIN)
  @Get('questions')
  listQuestions() {
    return this.quiz.listQuestions();
  }

  @Roles(UserRole.ADMIN)
  @Delete('questions/:id')
  async deleteQuestion(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: any) {
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    await this.quiz.deleteQuestion(id, userId, ipAddress, userAgent);
    return { success: true };
  }

  @Roles(UserRole.ADMIN)
  @Get('questions/:id/responses')
  getQuestionResponses(@Param('id') id: string) {
    return this.quiz.getQuestionResponses(id);
  }
}
