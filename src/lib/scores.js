import { supabase } from "./supabase";

export async function getRoundScores(
  roundId,
  playerIds
) {
  if (!roundId || playerIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("scores")
    .select(`
      id,
      round_id,
      player_id,
      hole_number,
      strokes,
      updated_at
    `)
    .eq("round_id", roundId)
    .in("player_id", playerIds);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function saveHoleScores({
  roundId,
  holeNumber,
  scores,
}) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(
      "Du skal være logget ind som markør."
    );
  }

  const rows = scores
    .filter(
      (score) =>
        score.strokes !== "" &&
        score.strokes !== null &&
        score.strokes !== undefined
    )
    .map((score) => ({
      round_id: roundId,
      player_id: score.playerId,
      hole_number: holeNumber,
      strokes: Number(score.strokes),
      updated_by: user.id,
    }));

  if (rows.length === 0) {
    throw new Error(
      "Indtast mindst én score, før hullet gemmes."
    );
  }

  const { error } = await supabase
    .from("scores")
    .upsert(rows, {
      onConflict:
        "round_id,player_id,hole_number",
    });

  if (error) {
    throw error;
  }

  return rows;
}