import { supabase } from "./supabase";

export async function getLiveRoundLeaderboard(
  roundNumber = 6
) {
  const { data: round, error: roundError } =
    await supabase
      .from("rounds")
      .select(`
        id,
        round_number,
        name,
        played_at,
        individual_enabled,
        team_enabled,
        course_id,
        tournaments!inner (
          season
        )
      `)
      .eq("tournaments.season", 2026)
      .eq("round_number", roundNumber)
      .single();

  if (roundError) {
    throw roundError;
  }

  const { data: holes, error: holesError } =
    await supabase
      .from("course_holes")
      .select(`
        hole_number,
        par,
        stroke_index
      `)
      .eq("course_id", round.course_id)
      .order("hole_number", {
        ascending: true,
      });

  if (holesError) {
    throw holesError;
  }

  const { data: roundPlayers, error: playersError } =
    await supabase
      .from("round_players")
      .select(`
        player_id,
        status,
        players (
          id,
          name,
          handicap_index
        )
      `)
      .eq("round_id", round.id)
      .in("status", [
        "registered",
        "confirmed",
        "completed",
      ]);

  if (playersError) {
    throw playersError;
  }

  const playerIds = (roundPlayers ?? []).map(
    (row) => row.player_id
  );

  let scoreRows = [];

  if (playerIds.length > 0) {
    const { data, error } = await supabase
      .from("scores")
      .select(`
        player_id,
        hole_number,
        strokes,
        updated_at
      `)
      .eq("round_id", round.id)
      .in("player_id", playerIds);

    if (error) {
      throw error;
    }

    scoreRows = data ?? [];
  }

  const parByHole = new Map(
    (holes ?? []).map((hole) => [
      hole.hole_number,
      hole.par,
    ])
  );

  const leaderboard = (roundPlayers ?? [])
    .map((row) => {
      const playerScores = scoreRows.filter(
        (score) =>
          score.player_id === row.player_id
      );

      const holesPlayed = playerScores.length;

      const scoreToPar = playerScores.reduce(
        (total, score) => {
          const holePar =
            parByHole.get(score.hole_number);

          if (holePar === undefined) {
            return total;
          }

          return total + score.strokes - holePar;
        },
        0
      );

      return {
        playerId: row.player_id,
        playerName:
          row.players?.name ?? "Ukendt spiller",
        handicap:
          row.players?.handicap_index ?? null,
        holesPlayed,
        scoreToPar,
      };
    })
    .sort((a, b) => {
      if (a.holesPlayed !== b.holesPlayed) {
        return b.holesPlayed - a.holesPlayed;
      }

      if (a.scoreToPar !== b.scoreToPar) {
        return a.scoreToPar - b.scoreToPar;
      }

      return a.playerName.localeCompare(
        b.playerName,
        "da"
      );
    });

  return {
    round,
    holes: holes ?? [],
    leaderboard,
  };
}