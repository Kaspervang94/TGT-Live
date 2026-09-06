import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import {
  getRoundScores,
  saveHoleScores,
} from "./lib/scores";

function formatScore(score) {
  if (score === null || score === undefined) {
    return "Afventer";
  }

  if (score === 0) {
    return "E";
  }

  return score > 0 ? `+${score}` : String(score);
}

function formatDate(date) {
  if (!date) {
    return "Ikke angivet";
  }

  return new Intl.DateTimeFormat("da-DK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatTime(time) {
  if (!time) {
    return "Ikke angivet";
  }

  return time.slice(0, 5);
}

function sortStandings(data) {
  return [...(data ?? [])].sort((a, b) => {
    const aQualified = a.counting_rounds === 4;
    const bQualified = b.counting_rounds === 4;

    if (aQualified !== bQualified) {
      return aQualified ? -1 : 1;
    }

    if (aQualified && bQualified) {
      if (a.halved_score !== b.halved_score) {
        return (
          (a.halved_score ?? Infinity) -
          (b.halved_score ?? Infinity)
        );
      }
    }

    if (a.counting_score !== b.counting_score) {
      return (
        (a.counting_score ?? Infinity) -
        (b.counting_score ?? Infinity)
      );
    }

    if (a.rounds_played !== b.rounds_played) {
      return b.rounds_played - a.rounds_played;
    }

    return a.player_name.localeCompare(
      b.player_name,
      "da"
    );
  });
}

function Leaderboard({ onOpenLogin }) {
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadStandings() {
      setLoading(true);
      setErrorMessage("");

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
        .eq("season", 2026);

      if (error) {
        console.error("Supabase-fejl:", error);
        setErrorMessage(error.message);
        setStandings([]);
        setLoading(false);
        return;
      }

      setStandings(sortStandings(data));
      setLoading(false);
    }

    loadStandings();
  }, []);

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

          <p>Aktuel individuel sæsonstilling</p>

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
          <div className="card-header">
            <div>
              <p className="eyebrow">
                Individuel turnering
              </p>

              <h2>Aktuel stilling</h2>

              <p className="description">
                De fire laveste rundescores tæller.
                Den samlede score halveres efter fire
                tællende runder.
              </p>
            </div>

            <div className="live-badge">
              <span className="live-dot" />
              LIVE
            </div>
          </div>

          {loading && (
            <div className="status-box">
              Henter stillingen fra Supabase...
            </div>
          )}

          {!loading && errorMessage && (
            <div className="error-box">
              <strong>
                Stillingen kunne ikke hentes
              </strong>

              <span>{errorMessage}</span>
            </div>
          )}

          {!loading &&
            !errorMessage &&
            standings.length === 0 && (
              <div className="status-box">
                Der blev ikke fundet nogen spillere i
                TGT 2026.
              </div>
            )}

          {!loading &&
            !errorMessage &&
            standings.length > 0 && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th className="position-column">
                        Placering
                      </th>

                      <th>Spiller</th>

                      <th className="number-column">
                        Spillet
                      </th>

                      <th className="number-column">
                        Tæller
                      </th>

                      <th className="number-column">
                        Bedste 4
                      </th>

                      <th className="number-column">
                        Halveret
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {standings.map((player, index) => (
                      <tr key={player.player_id}>
                        <td className="position-column">
                          <span
                            className={`position-badge position-${
                              index + 1
                            }`}
                          >
                            {index + 1}
                          </span>
                        </td>

                        <td>
                          <span className="player-name">
                            {player.player_name}
                          </span>
                        </td>

                        <td className="number-column">
                          {player.rounds_played}
                        </td>

                        <td className="number-column">
                          {player.counting_rounds} / 4
                        </td>

                        <td className="number-column score">
                          {formatScore(
                            player.counting_score
                          )}
                        </td>

                        <td className="number-column final-score">
                          {formatScore(
                            player.halved_score
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          <div className="card-footer">
            <span>
              Data hentes direkte fra TGT-databasen
            </span>

            <span>Sæson 2026</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function MarkerLogin({
  onCancel,
  onLoginSuccess,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();

    setLoggingIn(true);
    setLoginError("");

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

    if (error) {
      console.error("Loginfejl:", error);

      setLoginError(
        "Login mislykkedes. Kontrollér boldens mail og adgangskode."
      );

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
          Log ind med den mail og adgangskode, der
          tilhører bolden.
        </p>

        <form onSubmit={handleLogin}>
          <label className="form-label">
            Boldens mailadresse
          </label>

          <input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="bold1@tgt.dk"
            autoComplete="username"
            required
            className="form-input"
          />

          <label className="form-label">
            Adgangskode
          </label>

          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="Indtast adgangskode"
            autoComplete="current-password"
            required
            className="form-input"
          />

          {loginError && (
            <div className="error-box">
              {loginError}
            </div>
          )}

          <button
            type="submit"
            disabled={loggingIn}
            className="login-submit-button"
          >
            {loggingIn
              ? "Logger ind..."
              : "Log ind som markør"}
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="login-cancel-button"
          >
            Tilbage til leaderboard
          </button>
        </form>
      </section>
    </main>
  );
}

function MarkerDashboard({
  session,
  onLogout,
}) {
  const [assignment, setAssignment] = useState(null);
  const [players, setPlayers] = useState([]);
  const [holes, setHoles] = useState([]);
  const [existingScores, setExistingScores] =
    useState([]);

  const [selectedHole, setSelectedHole] = useState(1);
  const [draftScores, setDraftScores] = useState({});

  const [loading, setLoading] = useState(true);
  const [assignmentError, setAssignmentError] =
    useState("");

  const [savingScores, setSavingScores] =
    useState(false);

  const [saveMessage, setSaveMessage] =
    useState("");

  const [saveError, setSaveError] =
    useState("");

  async function loadScores(
    roundId,
    loadedPlayers
  ) {
    const playerIds = loadedPlayers.map(
      (player) => player.id
    );

    const scoreRows = await getRoundScores(
      roundId,
      playerIds
    );

    setExistingScores(scoreRows);

    const scoreMap = {};

    scoreRows.forEach((score) => {
      scoreMap[
        `${score.player_id}-${score.hole_number}`
      ] = score.strokes;
    });

    setDraftScores(scoreMap);
  }

  useEffect(() => {
    async function loadMarkerFlight() {
      setLoading(true);
      setAssignmentError("");

      const {
        data: markerRows,
        error: markerError,
      } = await supabase
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

      if (markerError) {
        console.error(
          "Fejl ved hentning af markørbold:",
          markerError
        );

        setAssignmentError(markerError.message);
        setLoading(false);
        return;
      }

      const markerAssignment = markerRows?.find(
        (row) =>
          row.flights?.rounds?.round_number === 6
      );

      if (!markerAssignment?.flights) {
        setAssignmentError(
          "Dette login er ikke knyttet til en bold i runde 6."
        );

        setLoading(false);
        return;
      }

      const flight = markerAssignment.flights;

      setAssignment(flight);

      const {
        data: flightPlayerRows,
        error: playerError,
      } = await supabase
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
        .order("playing_order", {
          ascending: true,
        });

      if (playerError) {
        console.error(
          "Fejl ved hentning af boldens spillere:",
          playerError
        );

        setAssignmentError(playerError.message);
        setLoading(false);
        return;
      }

      const loadedPlayers = (
        flightPlayerRows ?? []
      )
        .map((row) => ({
          playingOrder: row.playing_order,
          id: row.players?.id,
          name: row.players?.name,
          handicap:
            row.players?.handicap_index,
        }))
        .filter((player) => player.id);

      setPlayers(loadedPlayers);

      const courseId =
        flight.rounds?.course_id;

      if (!courseId) {
        setAssignmentError(
          "Runden har ikke en golfbane tilknyttet."
        );

        setLoading(false);
        return;
      }

      const {
        data: holeRows,
        error: holeError,
      } = await supabase
        .from("course_holes")
        .select(`
          id,
          hole_number,
          par,
          stroke_index
        `)
        .eq("course_id", courseId)
        .order("hole_number", {
          ascending: true,
        });

      if (holeError) {
        console.error(
          "Fejl ved hentning af scorekort:",
          holeError
        );

        setAssignmentError(holeError.message);
        setLoading(false);
        return;
      }

      setHoles(holeRows ?? []);

      try {
        await loadScores(
          flight.round_id,
          loadedPlayers
        );
      } catch (scoreError) {
        console.error(
          "Fejl ved hentning af scores:",
          scoreError
        );

        setAssignmentError(scoreError.message);
        setLoading(false);
        return;
      }

      setLoading(false);
    }

    loadMarkerFlight();
  }, [session.user.id]);

  function handleScoreChange(
    playerId,
    value
  ) {
    setSaveMessage("");
    setSaveError("");

    setDraftScores((currentScores) => ({
      ...currentScores,

      [`${playerId}-${selectedHole}`]:
        value === "" ? "" : Number(value),
    }));
  }

  async function handleSaveHole() {
    if (!assignment) {
      return;
    }

    setSavingScores(true);
    setSaveMessage("");
    setSaveError("");

    const scoresToSave = players.map(
      (player) => ({
        playerId: player.id,

        strokes:
          draftScores[
            `${player.id}-${selectedHole}`
          ] ?? "",
      })
    );

    const missingPlayers = scoresToSave.filter(
      (score) =>
        score.strokes === "" ||
        score.strokes === null ||
        score.strokes === undefined
    );

    if (missingPlayers.length > 0) {
      setSaveError(
        "Indtast en score for alle spillere i bolden."
      );

      setSavingScores(false);
      return;
    }

    try {
      await saveHoleScores({
        roundId: assignment.round_id,
        holeNumber: selectedHole,
        scores: scoresToSave,
      });

      setSaveMessage(
        `Hul ${selectedHole} er gemt for hele bolden.`
      );

      await loadScores(
        assignment.round_id,
        players
      );

      if (
        selectedHole < 18 &&
        holes.length >= selectedHole + 1
      ) {
        setSelectedHole(
          (currentHole) => currentHole + 1
        );
      }
    } catch (error) {
      console.error(
        "Fejl ved gemning af scores:",
        error
      );

      setSaveError(
        error.message ??
          "Scorerne kunne ikke gemmes."
      );
    } finally {
      setSavingScores(false);
    }
  }

  const selectedHoleData = holes.find(
    (hole) =>
      hole.hole_number === selectedHole
  );

  const completedHoles = holes.filter(
    (hole) =>
      players.length > 0 &&
      players.every((player) => {
        const savedScore =
          existingScores.find(
            (score) =>
              score.player_id === player.id &&
              score.hole_number ===
                hole.hole_number
          );

        return Boolean(savedScore);
      })
  ).length;

  return (
    <main className="marker-page">
      <section className="marker-card">
        <div className="marker-header">
          <div>
            <p className="eyebrow">
              TGT markørområde
            </p>

            <h1>
              {assignment?.name ??
                "Henter bold..."}
            </h1>

            <p className="description">
              Logget ind som {session.user.email}
            </p>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="logout-button"
          >
            Log ud
          </button>
        </div>

        {loading && (
          <div className="status-box">
            Henter bold, spillere og scorekort...
          </div>
        )}

        {!loading && assignmentError && (
          <div className="error-box">
            <strong>
              Bolden kunne ikke hentes
            </strong>

            <span>{assignmentError}</span>
          </div>
        )}

        {!loading &&
          !assignmentError &&
          assignment && (
            <>
              <div className="flight-information">
                <div>
                  <span>Runde</span>

                  <strong>
                    {
                      assignment.rounds
                        ?.round_number
                    }
                  </strong>
                </div>

                <div>
                  <span>Dato</span>

                  <strong>
                    {formatDate(
                      assignment.rounds
                        ?.played_at
                    )}
                  </strong>
                </div>

                <div>
                  <span>Starttid</span>

                  <strong>
                    {formatTime(
                      assignment.tee_time
                    )}
                  </strong>
                </div>

                <div>
                  <span>Gemt</span>

                  <strong>
                    {completedHoles} / 18 huller
                  </strong>
                </div>
              </div>

              <section
                style={{
                  marginTop: 28,
                  padding: 20,
                  border:
                    "1px solid rgba(16, 72, 51, 0.2)",
                  borderRadius: 18,
                  background: "#f7faf7",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div>
                    <p className="eyebrow">
                      Live scoreindtastning
                    </p>

                    <h2
                      style={{
                        margin: "4px 0",
                      }}
                    >
                      Hul {selectedHole}
                    </h2>

                    <p
                      style={{
                        margin: 0,
                        color: "#68756f",
                      }}
                    >
                      Par{" "}
                      {selectedHoleData?.par ??
                        "–"}
                      {" · "}
                      Index{" "}
                      {selectedHoleData
                        ?.stroke_index ?? "–"}
                    </p>
                  </div>

                  <select
                    value={selectedHole}
                    onChange={(event) => {
                      setSelectedHole(
                        Number(event.target.value)
                      );

                      setSaveMessage("");
                      setSaveError("");
                    }}
                    style={{
                      minWidth: 140,
                      padding: 12,
                      borderRadius: 10,
                      border:
                        "1px solid #cfd9d2",
                      background: "white",
                      fontWeight: 700,
                    }}
                  >
                    {holes.map((hole) => (
                      <option
                        key={hole.hole_number}
                        value={hole.hole_number}
                      >
                        Hul {hole.hole_number}
                        {" · "}
                        Par {hole.par}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    marginTop: 20,
                  }}
                >
                  {players.map((player) => {
                    const scoreKey =
                      `${player.id}-${selectedHole}`;

                    return (
                      <label
                        key={player.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "48px 1fr 90px",
                          alignItems: "center",
                          gap: 12,
                          padding: 14,
                          borderRadius: 12,
                          background: "white",
                          border:
                            "1px solid #e3e9e5",
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
                          <strong
                            style={{
                              display: "block",
                            }}
                          >
                            {player.name}
                          </strong>

                          <small
                            style={{
                              color: "#78827d",
                            }}
                          >
                            Handicap:{" "}
                            {player.handicap ??
                              "Ikke angivet"}
                          </small>
                        </span>

                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="20"
                          value={
                            draftScores[
                              scoreKey
                            ] ?? ""
                          }
                          onChange={(event) =>
                            handleScoreChange(
                              player.id,
                              event.target.value
                            )
                          }
                          placeholder="Slag"
                          style={{
                            width: "100%",
                            padding: 12,
                            borderRadius: 10,
                            border:
                              "1px solid #bdc9c1",
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
                  <div
                    className="error-box"
                    style={{
                      marginTop: 16,
                    }}
                  >
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
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 12,
                    marginTop: 20,
                  }}
                >
                  <button
                    type="button"
                    disabled={selectedHole <= 1}
                    onClick={() =>
                      setSelectedHole(
                        (currentHole) =>
                          Math.max(
                            1,
                            currentHole - 1
                          )
                      )
                    }
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border:
                        "1px solid #cbd5ce",
                      background: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Forrige hul
                  </button>

                  <button
                    type="button"
                    disabled={savingScores}
                    onClick={handleSaveHole}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: 0,
                      background: "#0b4935",
                      color: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {savingScores
                      ? "Gemmer..."
                      : `Gem hul ${selectedHole}`}
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
  const [session, setSession] =
    useState(null);

  const [
    checkingSession,
    setCheckingSession,
  ] = useState(true);

  const [showLogin, setShowLogin] =
    useState(false);

  useEffect(() => {
    async function getInitialSession() {
      const { data } =
        await supabase.auth.getSession();

      setSession(data.session ?? null);
      setCheckingSession(false);
    }

    getInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession);
        setCheckingSession(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();

    setSession(null);
    setShowLogin(false);
  }

  if (checkingSession) {
    return (
      <main className="login-page">
        <div className="status-box">
          Starter TGT Live...
        </div>
      </main>
    );
  }

  if (session) {
    return (
      <MarkerDashboard
        session={session}
        onLogout={handleLogout}
      />
    );
  }

  if (showLogin) {
    return (
      <MarkerLogin
        onCancel={() =>
          setShowLogin(false)
        }
        onLoginSuccess={(newSession) => {
          setSession(newSession);
          setShowLogin(false);
        }}
      />
    );
  }

  return (
    <Leaderboard
      onOpenLogin={() =>
        setShowLogin(true)
      }
    />
  );
}