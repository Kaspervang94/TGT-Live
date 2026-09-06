import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { getRoundScores, saveHoleScores } from "./lib/scores";
import { getLiveRoundLeaderboard } from "./lib/liveLeaderboard";

const SEASON = 2026;
const LIVE_ROUND = 6;

function formatScore(score) {
  if (score === null || score === undefined) return "Afventer";
  if (score === 0) return "E";
  return score > 0 ? `+${score}` : String(score);
}

function formatDate(date) {
  if (!date) return "Ikke angivet";
  return new Intl.DateTimeFormat("da-DK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatTime(time) {
  return time ? time.slice(0, 5) : "Ikke angivet";
}

function sortSeasonStandings(data) {
  return [...(data ?? [])].sort((a, b) => {
    const aQualified = a.counting_rounds === 4;
    const bQualified = b.counting_rounds === 4;
    if (aQualified !== bQualified) return aQualified ? -1 : 1;

    const halvedDifference =
      (a.halved_score ?? Infinity) - (b.halved_score ?? Infinity);
    if (aQualified && bQualified && halvedDifference !== 0) {
      return halvedDifference;
    }

    const scoreDifference =
      (a.counting_score ?? Infinity) - (b.counting_score ?? Infinity);
    if (scoreDifference !== 0) return scoreDifference;
    if (a.rounds_played !== b.rounds_played) {
      return b.rounds_played - a.rounds_played;
    }
    return a.player_name.localeCompare(b.player_name, "da");
  });
}

function PositionBadge({ position }) {
  return (
    <span className={`position-badge position-${position}`}>
      {position}
    </span>
  );
}

function Leaderboard({ onOpenLogin }) {
  const [tab, setTab] = useState("season");
  const [standings, setStandings] = useState([]);
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase
        .from("season_individual_standings")
        .select(`
          player_id,
          player_name,
          rounds_played,
          counting_rounds,
          counting_score,
          halved_score
        `)
        .eq("season", SEASON);

      if (error) throw error;
      setStandings(sortSeasonStandings(data));

      const currentLiveData = await getLiveRoundLeaderboard(LIVE_ROUND);
      setLiveData(currentLiveData);
    } catch (error) {
      console.error("Fejl ved hentning af TGT-data:", error);
      setErrorMessage(error.message ?? "Data kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel("tgt-public-live-round-6")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        () => loadData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "closest_to_pin" },
        () => loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const liveLeaderboard = liveData?.leaderboard ?? [];

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-content">
          <div className="brand-line">
            <span className="flag">⛳</span>
            <span>TGT LIVE</span>
          </div>
          <h1>
            TGT 2026
            <span>Leaderboard</span>
          </h1>
          <p>Sæsonstilling og live-resultater</p>
          <button
            type="button"
            onClick={onOpenLogin}
            className="marker-login-button"
          >
            Markør-login
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="leaderboard-card">
          <div className="tgt-tabs" style={{ display: "flex", gap: 10, padding: 16 }}>
            <button
              type="button"
              onClick={() => setTab("season")}
              className={tab === "season" ? "login-submit-button" : "login-cancel-button"}
            >
              Sæsonstilling
            </button>
            <button
              type="button"
              onClick={() => setTab("live")}
              className={tab === "live" ? "login-submit-button" : "login-cancel-button"}
            >
              Runde 6 live
            </button>
          </div>

          <div className="card-header">
            <div>
              <p className="eyebrow">
                {tab === "season" ? "Individuel turnering" : "Live fra Lübker"}
              </p>
              <h2>
                {tab === "season"
                  ? "Aktuel sæsonstilling"
                  : liveData?.round?.name ?? "Runde 6"}
              </h2>
              <p className="description">
                {tab === "season"
                  ? "De fire laveste rundescores tæller. Den samlede score halveres efter fire tællende runder."
                  : "Stillingen opdateres automatisk, når markørerne gemmer et hul."}
              </p>
            </div>
            <div className="live-badge">
              <span className="live-dot" /> LIVE
            </div>
          </div>

          {loading && <div className="status-box">Henter TGT-data...</div>}

          {!loading && errorMessage && (
            <div className="error-box">
              <strong>Data kunne ikke hentes</strong>
              <span>{errorMessage}</span>
            </div>
          )}

          {!loading && !errorMessage && tab === "season" && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th className="position-column">Placering</th>
                    <th>Spiller</th>
                    <th className="number-column">Spillet</th>
                    <th className="number-column">Tæller</th>
                    <th className="number-column">Bedste 4</th>
                    <th className="number-column">Halveret</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((player, index) => (
                    <tr key={player.player_id}>
                      <td className="position-column">
                        <PositionBadge position={index + 1} />
                      </td>
                      <td><span className="player-name">{player.player_name}</span></td>
                      <td className="number-column">{player.rounds_played}</td>
                      <td className="number-column">{player.counting_rounds} / 4</td>
                      <td className="number-column score">
                        {formatScore(player.counting_score)}
                      </td>
                      <td className="number-column final-score">
                        {formatScore(player.halved_score)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !errorMessage && tab === "live" && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th className="position-column">Placering</th>
                    <th>Spiller</th>
                    <th className="number-column">Thru</th>
                    <th className="number-column">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {liveLeaderboard.map((player, index) => (
                    <tr key={player.playerId}>
                      <td className="position-column">
                        <PositionBadge position={index + 1} />
                      </td>
                      <td>
                        <span className="player-name">{player.playerName}</span>
                        <small style={{ display: "block", color: "#78827d" }}>
                          Handicap: {player.handicap ?? "Ikke angivet"}
                        </small>
                      </td>
                      <td className="number-column">{player.holesPlayed}</td>
                      <td className="number-column final-score">
                        {player.holesPlayed === 0
                          ? "Ikke startet"
                          : formatScore(player.scoreToPar)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {liveLeaderboard.length === 0 && (
                <div className="status-box">Der er ingen deltagere i Runde 6.</div>
              )}
            </div>
          )}

          <div className="card-footer">
            <span>Data hentes direkte fra TGT-databasen</span>
            <span>Sæson 2026</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function MarkerLogin({ onCancel, onLoginSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      console.error("Loginfejl:", error);
      setLoginError("Login mislykkedes. Kontrollér boldens mail og adgangskode.");
      setLoggingIn(false);
      return;
    }

    setLoggingIn(false);
    onLoginSuccess(data.session);
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-icon">⛳</div>
        <p className="eyebrow">TGT 2026</p>
        <h1>Markør-login</h1>
        <p className="description">
          Log ind med den mail og adgangskode, der tilhører bolden.
        </p>

        <form onSubmit={handleLogin}>
          <label className="form-label">Boldens mailadresse</label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="bold1@tgt.dk"
            autoComplete="username"
            required
            className="form-input"
          />

          <label className="form-label">Adgangskode</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Indtast adgangskode"
            autoComplete="current-password"
            required
            className="form-input"
          />

          {loginError && <div className="error-box">{loginError}</div>}

          <button type="submit" disabled={loggingIn} className="login-submit-button">
            {loggingIn ? "Logger ind..." : "Log ind som markør"}
          </button>
          <button type="button" onClick={onCancel} className="login-cancel-button">
            Tilbage til leaderboard
          </button>
        </form>
      </section>
    </main>
  );
}

function MarkerDashboard({ session, onLogout }) {
  const [assignment, setAssignment] = useState(null);
  const [players, setPlayers] = useState([]);
  const [holes, setHoles] = useState([]);
  const [existingScores, setExistingScores] = useState([]);
  const [selectedHole, setSelectedHole] = useState(1);
  const [draftScores, setDraftScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [assignmentError, setAssignmentError] = useState("");
  const [savingScores, setSavingScores] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  const loadScores = useCallback(async (roundId, loadedPlayers) => {
    const playerIds = loadedPlayers.map((player) => player.id);
    const scoreRows = await getRoundScores(roundId, playerIds);
    setExistingScores(scoreRows);

    const scoreMap = {};
    scoreRows.forEach((score) => {
      scoreMap[`${score.player_id}-${score.hole_number}`] = score.strokes;
    });
    setDraftScores(scoreMap);
  }, []);

  useEffect(() => {
    async function loadMarkerFlight() {
      setLoading(true);
      setAssignmentError("");

      try {
        const { data: markerRows, error: markerError } = await supabase
          .from("flight_markers")
          .select(`
            flight_id,
            active,
            flights (
              id,
              name,
              flight_number,
              tee_time,
              status,
              round_id,
              rounds (
                id,
                round_number,
                name,
                played_at,
                course_id
              )
            )
          `)
          .eq("user_id", session.user.id)
          .eq("active", true);

        if (markerError) throw markerError;

        const markerAssignment = markerRows?.find(
          (row) => row.flights?.rounds?.round_number === LIVE_ROUND
        );

        if (!markerAssignment?.flights) {
          throw new Error("Dette login er ikke knyttet til en bold i Runde 6.");
        }

        const flight = markerAssignment.flights;
        setAssignment(flight);

        const { data: playerRows, error: playerError } = await supabase
          .from("flight_players")
          .select(`
            playing_order,
            player_id,
            players (
              id,
              name,
              handicap_index
            )
          `)
          .eq("flight_id", flight.id)
          .order("playing_order", { ascending: true });

        if (playerError) throw playerError;

        const loadedPlayers = (playerRows ?? [])
          .map((row) => ({
            playingOrder: row.playing_order,
            id: row.players?.id,
            name: row.players?.name,
            handicap: row.players?.handicap_index,
          }))
          .filter((player) => player.id);

        setPlayers(loadedPlayers);

        const courseId = flight.rounds?.course_id;
        if (!courseId) throw new Error("Runden har ikke en golfbane tilknyttet.");

        const { data: holeRows, error: holeError } = await supabase
          .from("course_holes")
          .select("id, hole_number, par, stroke_index")
          .eq("course_id", courseId)
          .order("hole_number", { ascending: true });

        if (holeError) throw holeError;
        setHoles(holeRows ?? []);
        await loadScores(flight.round_id, loadedPlayers);
      } catch (error) {
        console.error("Fejl ved hentning af markørdata:", error);
        setAssignmentError(error.message ?? "Markørdata kunne ikke hentes.");
      } finally {
        setLoading(false);
      }
    }

    loadMarkerFlight();
  }, [session.user.id, loadScores]);

  useEffect(() => {
    if (!assignment?.round_id || players.length === 0) return undefined;

    const channel = supabase
      .channel(`marker-scores-${assignment.round_id}-${assignment.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scores",
          filter: `round_id=eq.${assignment.round_id}`,
        },
        () => loadScores(assignment.round_id, players)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [assignment, players, loadScores]);

  function handleScoreChange(playerId, value) {
    setSaveMessage("");
    setSaveError("");
    setDraftScores((currentScores) => ({
      ...currentScores,
      [`${playerId}-${selectedHole}`]: value === "" ? "" : Number(value),
    }));
  }

  async function handleSaveHole() {
    if (!assignment) return;

    setSavingScores(true);
    setSaveMessage("");
    setSaveError("");

    const scoresToSave = players.map((player) => ({
      playerId: player.id,
      strokes: draftScores[`${player.id}-${selectedHole}`] ?? "",
    }));

    const hasMissingScores = scoresToSave.some(
      (score) =>
        score.strokes === "" ||
        score.strokes === null ||
        score.strokes === undefined
    );

    if (hasMissingScores) {
      setSaveError("Indtast en score for alle spillere i bolden.");
      setSavingScores(false);
      return;
    }

    try {
      await saveHoleScores({
        roundId: assignment.round_id,
        holeNumber: selectedHole,
        scores: scoresToSave,
      });

      await loadScores(assignment.round_id, players);
      setSaveMessage(`Hul ${selectedHole} er gemt for hele bolden.`);

      if (selectedHole < 18) {
        setSelectedHole((currentHole) => currentHole + 1);
      }
    } catch (error) {
      console.error("Fejl ved gemning af scores:", error);
      setSaveError(error.message ?? "Scorerne kunne ikke gemmes.");
    } finally {
      setSavingScores(false);
    }
  }

  const selectedHoleData = holes.find(
    (hole) => hole.hole_number === selectedHole
  );

  const completedHoles = useMemo(
    () =>
      holes.filter(
        (hole) =>
          players.length > 0 &&
          players.every((player) =>
            existingScores.some(
              (score) =>
                score.player_id === player.id &&
                score.hole_number === hole.hole_number
            )
          )
      ).length,
    [holes, players, existingScores]
  );

  return (
    <main className="marker-page">
      <section className="marker-card">
        <div className="marker-header">
          <div>
            <p className="eyebrow">TGT markørområde</p>
            <h1>{assignment?.name ?? "Henter bold..."}</h1>
            <p className="description">Logget ind som {session.user.email}</p>
          </div>
          <button type="button" onClick={onLogout} className="logout-button">
            Log ud
          </button>
        </div>

        {loading && (
          <div className="status-box">Henter bold, spillere og scorekort...</div>
        )}

        {!loading && assignmentError && (
          <div className="error-box">
            <strong>Bolden kunne ikke hentes</strong>
            <span>{assignmentError}</span>
          </div>
        )}

        {!loading && !assignmentError && assignment && (
          <>
            <div className="flight-information">
              <div><span>Runde</span><strong>{assignment.rounds?.round_number}</strong></div>
              <div><span>Dato</span><strong>{formatDate(assignment.rounds?.played_at)}</strong></div>
              <div><span>Starttid</span><strong>{formatTime(assignment.tee_time)}</strong></div>
              <div><span>Gemt</span><strong>{completedHoles} / 18 huller</strong></div>
            </div>

            <section
              style={{
                marginTop: 28,
                padding: 20,
                border: "1px solid rgba(16, 72, 51, 0.2)",
                borderRadius: 18,
                background: "#f7faf7",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div>
                  <p className="eyebrow">Live scoreindtastning</p>
                  <h2 style={{ margin: "4px 0" }}>Hul {selectedHole}</h2>
                  <p style={{ margin: 0, color: "#68756f" }}>
                    Par {selectedHoleData?.par ?? "–"} · Index{" "}
                    {selectedHoleData?.stroke_index ?? "–"}
                  </p>
                </div>

                <select
                  value={selectedHole}
                  onChange={(event) => {
                    setSelectedHole(Number(event.target.value));
                    setSaveMessage("");
                    setSaveError("");
                  }}
                  style={{
                    minWidth: 140,
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #cfd9d2",
                    background: "white",
                    fontWeight: 700,
                  }}
                >
                  {holes.map((hole) => (
                    <option key={hole.hole_number} value={hole.hole_number}>
                      Hul {hole.hole_number} · Par {hole.par}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
                {players.map((player) => {
                  const scoreKey = `${player.id}-${selectedHole}`;
                  return (
                    <label
                      key={player.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "48px 1fr 90px",
                        alignItems: "center",
                        gap: 12,
                        padding: 14,
                        borderRadius: 12,
                        background: "white",
                        border: "1px solid #e3e9e5",
                      }}
                    >
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          background: "#e8f0e9",
                          fontWeight: 800,
                        }}
                      >
                        {player.playingOrder}
                      </span>

                      <span>
                        <strong style={{ display: "block" }}>{player.name}</strong>
                        <small style={{ color: "#78827d" }}>
                          Handicap: {player.handicap ?? "Ikke angivet"}
                        </small>
                      </span>

                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="20"
                        value={draftScores[scoreKey] ?? ""}
                        onChange={(event) =>
                          handleScoreChange(player.id, event.target.value)
                        }
                        placeholder="Slag"
                        style={{
                          width: "100%",
                          padding: 12,
                          borderRadius: 10,
                          border: "1px solid #bdc9c1",
                          textAlign: "center",
                          fontSize: 18,
                          fontWeight: 800,
                        }}
                      />
                    </label>
                  );
                })}
              </div>

              {saveError && (
                <div className="error-box" style={{ marginTop: 16 }}>
                  {saveError}
                </div>
              )}

              {saveMessage && (
                <div
                  style={{
                    marginTop: 16,
                    padding: 14,
                    borderRadius: 10,
                    background: "#e7f6eb",
                    color: "#176334",
                    fontWeight: 700,
                  }}
                >
                  {saveMessage}
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginTop: 20,
                }}
              >
                <button
                  type="button"
                  disabled={selectedHole <= 1}
                  onClick={() =>
                    setSelectedHole((currentHole) => Math.max(1, currentHole - 1))
                  }
                  className="login-cancel-button"
                >
                  Forrige hul
                </button>

                <button
                  type="button"
                  disabled={savingScores}
                  onClick={handleSaveHole}
                  className="login-submit-button"
                >
                  {savingScores ? "Gemmer..." : `Gem hul ${selectedHole}`}
                </button>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setCheckingSession(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setShowLogin(false);
  }

  if (checkingSession) {
    return (
      <main className="login-page">
        <div className="status-box">Starter TGT Live...</div>
      </main>
    );
  }

  if (session) {
    return <MarkerDashboard session={session} onLogout={handleLogout} />;
  }

  if (showLogin) {
    return (
      <MarkerLogin
        onCancel={() => setShowLogin(false)}
        onLoginSuccess={(newSession) => {
          setSession(newSession);
          setShowLogin(false);
        }}
      />
    );
  }

  return <Leaderboard onOpenLogin={() => setShowLogin(true)} />;
}
