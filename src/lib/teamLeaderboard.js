import { supabase } from "./supabase";
import { calculateBestBallLeaderboard } from "./netScoreEngine";

export async function getTeamLeaderboard({
  season = 2026,
  roundNumber = 6,
} = {}) {
  const { data: round, error: roundError } = await supabase
    .from("rounds")
    .select(`
      id,
      tournament_id,
      course_id,
      round_number,
      name,
      played_at,
      status,
      team_enabled,
      tournaments!inner (
        id,
        season
      )
    `)
    .eq("tournaments.season", season)
    .eq("round_number", roundNumber)
    .single();

  if (roundError) throw roundError;
  if (!round) throw new Error(`Runde ${roundNumber} blev ikke fundet.`);
  if (!round.team_enabled) {
    throw new Error(`Holdturneringen er ikke aktiveret i Runde ${roundNumber}.`);
  }
  if (!round.course_id) {
    throw new Error(`Runde ${roundNumber} har ingen golfbane tilknyttet.`);
  }

  const { data: holes, error: holesError } = await supabase
    .from("course_holes")
    .select("hole_number, par, stroke_index")
    .eq("course_id", round.course_id)
    .order("hole_number", { ascending: true });

  if (holesError) throw holesError;
  if (!holes || holes.length === 0) {
    throw new Error("Banens scorekort kunne ikke findes.");
  }

  const { data: teamRows, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, active")
    .eq("tournament_id", round.tournament_id)
    .eq("active", true)
    .order("name", { ascending: true });

  if (teamsError) throw teamsError;

  const teamIds = (teamRows ?? []).map((team) => team.id);
  if (teamIds.length === 0) {
    return { round, holes, teams: [], scores: [], leaderboard: [] };
  }

  const { data: membershipRows, error: membershipsError } = await supabase
    .from("team_members")
    .select(`
      team_id,
      player_id,
      players (
        id,
        name,
        handicap_index,
        active,
        team_competition
      )
    `)
    .in("team_id", teamIds);

  if (membershipsError) throw membershipsError;

  const eligibleMemberships = (membershipRows ?? []).filter(
    (membership) =>
      membership.players?.active === true &&
      membership.players?.team_competition !== false
  );

  const playerIds = [
    ...new Set(eligibleMemberships.map((membership) => membership.player_id)),
  ];

  let roundPlayerRows = [];
  if (playerIds.length > 0) {
    const { data, error } = await supabase
      .from("round_players")
      .select("player_id, handicap_index, playing_handicap, status, tee_id")
      .eq("round_id", round.id)
      .in("player_id", playerIds);

    if (error) throw error;
    roundPlayerRows = data ?? [];
  }

  const roundPlayerByPlayerId = new Map(
    roundPlayerRows.map((roundPlayer) => [roundPlayer.player_id, roundPlayer])
  );

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

  const teams = (teamRows ?? []).map((team) => {
    const memberships = eligibleMemberships.filter(
      (membership) => membership.team_id === team.id
    );

    const players = memberships.map((membership) => {
      const player = membership.players;
      const roundPlayer = roundPlayerByPlayerId.get(membership.player_id);

      return {
        playerId: player.id,
        playerName: player.name,
        teamCompetition: player.team_competition,
        handicapIndex:
          roundPlayer?.handicap_index ?? player.handicap_index ?? null,
        playingHandicap: roundPlayer?.playing_handicap ?? 0,
        roundStatus: roundPlayer?.status ?? "Ikke tilmeldt",
      };
    });

    return {
      teamId: team.id,
      teamName: team.name,
      players,
    };
  });

  const leaderboard = calculateBestBallLeaderboard({
    teams,
    holes,
    scores: scoreRows,
  });

  return {
    round,
    holes,
    teams,
    scores: scoreRows,
    leaderboard,
  };
}

export function subscribeToTeamLeaderboard({ roundId, callback }) {
  if (!roundId) {
    throw new Error("roundId mangler ved oprettelse af Realtime.");
  }

  const channel = supabase
    .channel(`tgt-team-leaderboard-${roundId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "scores",
        filter: `round_id=eq.${roundId}`,
      },
      () => callback?.()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
