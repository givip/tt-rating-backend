import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ZodBody } from '../common/zod-swagger';
import { TournamentsService } from './tournaments.service';

const CreateTournamentDto = z
  .object({
    title: z.string().min(1),
    clubId: z.string().uuid().nullish(),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    format: z.enum(['round_robin', 'groups_playoff', 'single_elim', 'swiss']).optional(),
    matchFormat: z.enum(['bo3', 'bo5', 'bo7']).optional(),
    numberOfTables: z.number().int().min(1).max(32).optional(),
    minRating: z.number().int().nullish(),
    maxRating: z.number().int().nullish(),
  })
  .passthrough();

const AddParticipantDto = z.object({ playerId: z.string().uuid() }).strict();

const PrepareDto = z.object({
  format: z.enum(['round_robin', 'groups_playoff', 'single_elim', 'swiss']),
  matchFormat: z.enum(['bo3', 'bo5', 'bo7']).optional(),
  groupSize: z.union([z.literal(3), z.literal(4), z.literal(5)]).optional(),
  hasThirdPlaceMatch: z.boolean().optional(),
  seedOverrides: z.record(z.string(), z.number().int().positive()).optional(),
});
type PrepareDto = z.infer<typeof PrepareDto>;

const ResultDto = z.object({
  winnerId: z.string().uuid(),
  setsPlayer1: z.number().int().min(0).max(7),
  setsPlayer2: z.number().int().min(0).max(7),
  scoreDetails: z.unknown().optional(),
  playedAt: z.coerce.date().optional(),
});
type ResultDto = z.infer<typeof ResultDto>;

const CreateMatchDto = z
  .object({
    round: z.number().int().min(1),
    player1Id: z.string().uuid(),
    player2Id: z.string().uuid(),
    winnerId: z.string().uuid().nullish(),
    setsPlayer1: z.number().int().min(0).nullish(),
    setsPlayer2: z.number().int().min(0).nullish(),
    scoreDetails: z.unknown().optional(),
    playedAt: z.coerce.date().nullish(),
  })
  .strict();

function parseCreateMatch(body: unknown) {
  try {
    return CreateMatchDto.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException('Invalid request body');
    }
    throw err;
  }
}

type AuthedRequest = FastifyRequest & { user: { userId: string; role: string } };

@ApiTags('tournaments')
@Controller('tournaments')
export class TournamentsController {
  constructor(private tournaments: TournamentsService) {}

  @Get()
  @ApiOperation({ summary: 'List tournaments' })
  async findAll(@Query('organizerId') organizerId?: string) {
    return this.tournaments.findAll(organizerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tournament details with participants and matches' })
  async findOne(@Param('id') id: string) {
    return this.tournaments.findOne(id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Create tournament (organizer)' })
  @ZodBody(CreateTournamentDto)
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.tournaments.create(req.user, body as Record<string, unknown>);
  }

  @Post(':id/participants')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Add participant to tournament' })
  @ZodBody(AddParticipantDto)
  async addParticipant(
    @Req() req: AuthedRequest,
    @Param('id') tournamentId: string,
    @Body() body: { playerId: string },
  ) {
    return this.tournaments.addParticipant(tournamentId, body.playerId, req.user);
  }

  @Post(':id/matches')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Create a match in the tournament' })
  @ZodBody(CreateMatchDto)
  async createMatch(
    @Req() req: AuthedRequest,
    @Param('id') tournamentId: string,
    @Body() body: unknown,
  ) {
    const dto = parseCreateMatch(body);
    return this.tournaments.createMatch(tournamentId, dto, req.user);
  }

  @Post(':id/prepare')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Prepare tournament: run draw and persist matches' })
  @ZodBody(PrepareDto)
  async prepare(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    let dto: PrepareDto;
    try {
      dto = PrepareDto.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException('Invalid request body');
      }
      throw err;
    }
    await this.tournaments.prepare(id, dto, {
      userId: req.user.userId,
      role: req.user.role,
    });
    return { ok: true };
  }

  @Post(':id/rewind')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Rewind a prepared tournament back to open' })
  async rewind(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.tournaments.rewind(id, {
      userId: req.user.userId,
      role: req.user.role,
    });
    return { ok: true };
  }

  @Post(':id/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Start a prepared tournament (move to in_progress)' })
  async start(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.tournaments.start(id, {
      userId: req.user.userId,
      role: req.user.role,
    });
    return { ok: true };
  }

  @Delete(':id/participants/:playerId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Drop a participant from the tournament' })
  async dropParticipant(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('playerId') playerId: string,
  ) {
    await this.tournaments.dropParticipant(id, playerId, {
      userId: req.user.userId,
      role: req.user.role,
    });
    return { ok: true };
  }

  @Patch(':id/matches/:matchId/result')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Record a match result and advance the bracket' })
  @ZodBody(ResultDto)
  async patchResult(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() body: unknown,
  ) {
    let dto: ResultDto;
    try {
      dto = ResultDto.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException('Invalid request body');
      }
      throw err;
    }
    await this.tournaments.patchMatchResult(id, matchId, dto, {
      userId: req.user.userId,
      role: req.user.role,
    });
    return { ok: true };
  }

  @Get(':id/standings')
  @ApiOperation({ summary: 'Get tournament standings (groups + brackets)' })
  async getStandings(@Param('id') id: string) {
    return this.tournaments.getStandings(id);
  }

  @Get(':id/next-matches')
  @ApiOperation({ summary: 'Get the next scheduled matches for the tournament' })
  async getNextMatches(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit != null ? parseInt(limit, 10) : undefined;
    if (parsedLimit != null && (Number.isNaN(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException('limit must be a positive integer');
    }
    return this.tournaments.getNextMatches(id, parsedLimit);
  }

  @Patch(':id/finalize')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Finalize tournament and trigger rating calculation' })
  async finalize(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tournaments.finalize(id, req.user);
  }
}
