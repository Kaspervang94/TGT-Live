import { supabase } from "./supabase";

function allocatedStrokes(playingHandicap, strokeIndex) {
  const handicap = Number(playingHandicap);
  const index = Number(strokeIndex);

  if (!Number.isFinite(handicap) || !Number.isFinite(index) || handicap <= 0) {
    return 0;
  }

  return (
    Math.floor((handicap - 1) / 18) +
    (index <= ((handicap - 1) % 18) + 1 ? 1 : 0)
  );
}

export async function getLiveRoundLeaderboard({
  season = 2026,
  roundId = null,
  roundNumber = null,
} = {}) {
  let roundQuery = supabase
    .from("rounds")
    .select(`
      id,
      round_number,
      name,
      played_at,
      status,
      individual_enabled,
      team_enabled,
      course_id,
      tee_id,
      courses (
        club_name,
        course_name
      ),
      course_tees (
        tee_name,
        course_rating,
        slope_rating
      ),
      tournaments!inner (
        season
      )
    `)
    .eq("tournaments.season", season);

  if (roundId) {
    roundQuery = roundQuery.eq("id", roundId);
  } else if (roundNumber !== null) {
    roundQuery = roundQuery.eq("round_number", roundNumber);
  } else {
    roundQuery = roundQuery
      .in("status", ["live", "ready", "submitted", "completed", "locked"])
      .order("round_number", { ascending: false })
      .limit(1);
  }

  const { data: roundRows, error: roundError } = await roundQuery.limit(1);
  if (roundError) throw roundError;

  const round = roundRows?.[0] ?? null;
  if (!round) {
    return { round: null, holes: [], leaderboard: [] };
  }

  const [holesResult, playersResult] = await Promise.all([
    supabase
      .from("course_holes")
      .select("hole_number, par, stroke_index")
      .eq("course_id", round.course_id)
      .order("hole_number", { ascending: true }),

    supabase
      .from("round_players")
      .select(`
        player_id,
        handicap_index,
        playing_handicap,
        status,
        players (
          id,
          name,
          handicap_index
        )
      `)
      .eq("round_id", round.id)
      .in("status", ["registered", "confirmed", "completed"]),
  ]);

  if (holesResult.error) throw holesResult.error;
  if (playersResult.error) throw playersResult.error;

  const holes = holesResult.data ?? [];
  const roundPlayers = playersResult.data ?? [];
  const playerIds = roundPlayers.map((row) => row.player_id);

  let scoreRows = [];
  if (playerIds.length > 0) {
    const { data, error } = await supabase
      .from("scores")
      .select("player_id, hole_number, strokes, updated_at")
      .eq("round_id", round.id)
      .in("player_id", playerIds);

    if (error) throw error;
    scoreRows = data ?? [];
  }

  const leaderboard = roundPlayers
    .map((row) => {
      const playerScores = scoreRows.filter(
        (score) => score.player_id === row.player_id
      );

      const handicapIndex =
        row.handicap_index ?? row.players?.handicap_index ?? null;
      const playingHandicap = row.playing_handicap ?? null;

      const scorecard = holes.map((hole) => {
        const score = playerScores.find(
          (item) => item.hole_number === hole.hole_number
        );
        const strokes = score?.strokes ?? null;
        const strokesReceived = allocatedStrokes(
          playingHandicap,
          hole.stroke_index
        );
        const netStrokes =
          strokes === null ? null : strokes - strokesReceived;

        return {
          holeNumber: hole.hole_number,
          par: hole.par,
          strokeIndex: hole.stroke_index,
          strokesReceived,
          strokes,
          grossToPar: strokes === null ? null : strokes - hole.par,
          netStrokes,
          toPar: netStrokes === null ? null : netStrokes - hole.par,
        };
      });

      const playedHoles = scorecard.filter((hole) => hole.strokes !== null);
      const holesPlayed = playedHoles.length;
      const grossStrokes = playedHoles.reduce(
        (total, hole) => total + Number(hole.strokes),
        0
      );
      const netStrokes = playedHoles.reduce(
        (total, hole) => total + Number(hole.netStrokes),
        0
      );
      const grossToPar = playedHoles.reduce(
        (total, hole) => total + hole.grossToPar,
        0
      );
      const scoreToPar = playedHoles.reduce(
        (total, hole) => total + hole.toPar,
        0
      );
      const strokesReceived = playedHoles.reduce(
        (total, hole) => total + hole.strokesReceived,
        0
      );

      return {
        playerId: row.player_id,
        playerName: row.players?.name ?? "Ukendt spiller",
        handicap: handicapIndex,
        handicapIndex,
        playingHandicap,
        holesPlayed,
        grossStrokes,
        netStrokes,
        grossToPar,
        strokesReceived,
        scoreToPar,
        scorecard,
      };
    })
    .sort((a, b) => {
      if (a.holesPlayed !== b.holesPlayed) return b.holesPlayed - a.holesPlayed;
      if (a.scoreToPar !== b.scoreToPar) return a.scoreToPar - b.scoreToPar;
      return a.playerName.localeCompare(b.playerName, "da");
    });

  return { round, holes, leaderboard };
}
