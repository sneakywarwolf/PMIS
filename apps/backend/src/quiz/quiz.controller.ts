import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { QuizService } from './quiz.service';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateQuizQuestionDto } from './dto/create-quiz-question.dto';
import { UpdateQuizQuestionDto } from './dto/update-quiz-question.dto';
import { AnswerQuizQuestionDto } from './dto/answer-quiz-question.dto';
import { Permission } from '../common/permissions';

@Controller('quiz')
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  @Get('today')
  @Permission('quiz.play')
  getToday(@CurrentUser('id') userId: string) {
    return this.quiz.getTodayQuestion(userId);
  }

  @Get('revealed')
  @Permission('quiz.play')
  getRecentlyRevealed(@CurrentUser('id') userId: string) {
    return this.quiz.getRecentlyRevealed(userId);
  }

  @Post('today/answer')
  @Permission('quiz.play')
  answerToday(@CurrentUser('id') userId: string, @Body() dto: AnswerQuizQuestionDto) {
    return this.quiz.submitAnswer(userId, dto.questionId, dto.selectedOption);
  }

  @Get('log')
  @Permission('quiz.play')
  getLog(@CurrentUser('id') userId: string, @Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20) {
    return this.quiz.getLog(page, pageSize, userId);
  }

  @Get('log/:id')
  @Permission('quiz.play')
  getLogEntry(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.quiz.getLogEntry(id, userId);
  }

  @Post('log/:id/answer')
  @Permission('quiz.play')
  answerLate(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: AnswerQuizQuestionDto) {
    return this.quiz.submitLateAnswer(userId, id, dto.selectedOption);
  }

  @Get('scorecard')
  @Permission('quiz.play')
  getScorecard(@CurrentUser('id') userId: string) {
    return this.quiz.getScorecard(userId);
  }

  @Get('scorecard/leaderboard')
  @Permission('quiz.play')
  getLeaderboard() {
    return this.quiz.getLeaderboard();
  }

  @Post('questions')
  @Permission('quiz.manage_questions')
  createQuestion(@CurrentUser('id') userId: string, @Body() dto: CreateQuizQuestionDto, @Req() req: any) {
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.quiz.createQuestion(userId, dto, ipAddress, userAgent);
  }

  @Put('questions/:id')
  @Permission('quiz.manage_questions')
  updateQuestion(@Param('id') id: string, @Body() dto: UpdateQuizQuestionDto, @CurrentUser('id') userId: string, @Req() req: any) {
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.quiz.updateQuestion(id, dto, userId, ipAddress, userAgent);
  }

  @Get('questions')
  @Permission('quiz.manage_questions')
  listQuestions() {
    return this.quiz.listQuestions();
  }

  @Delete('questions/:id')
  @Permission('quiz.manage_questions')
  async deleteQuestion(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: any) {
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    await this.quiz.deleteQuestion(id, userId, ipAddress, userAgent);
    return { success: true };
  }

  @Get('questions/:id/responses')
  @Permission('quiz.view_responses')
  getQuestionResponses(@Param('id') id: string) {
    return this.quiz.getQuestionResponses(id);
  }
}
