# Receiving Flashcards in Unity

The desktop app (Electron) runs a WebSocket server. The tutoring UI sends
flashcard decks to your Unity game over that socket as JSON. This file explains
how to connect the Unity side and parse the messages. **No app/frontend changes
are needed — only the Unity code below.**

---

## 1. Connection

The Electron main process starts a WebSocket server at:

```
ws://localhost:8765
```

Your Unity game must connect as a client and identify itself as `unity` using a
query parameter so the server routes messages to it:

```
ws://localhost:8765?client=unity
```

Recommended package: **NativeWebSocket** (`com.endel.nativewebsocket`)
- Install via Package Manager → Add package from git URL:
  `https://github.com/endel/NativeWebSocket.git#upm`

---

## 2. Message format

When the user taps **Send to Game** on a flashcard deck, the app sends one JSON
message:

```json
{
  "from": "app",
  "type": "flashcards",
  "deckId": "conversation-uuid",
  "deckTitle": "SN1 vs SN2 Review",
  "count": 5,
  "cards": [
    { "id": "card-uuid-1", "front": "What is an SN1 reaction?", "back": "A two-step unimolecular substitution..." },
    { "id": "card-uuid-2", "front": "...", "back": "..." }
  ],
  "sentAt": "2026-06-26T10:42:00.000Z"
}
```

- `from`     — always `"app"` for messages coming from the tutor UI.
- `type`     — message kind. Switch on this; currently `"flashcards"`.
- `deckId`   — the source conversation id (stable identifier for the deck).
- `deckTitle`— human-readable deck name to show in-game.
- `count`    — number of cards (equals `cards.length`).
- `cards`    — the array of flashcards, each `{ id, front, back }`.
- `sentAt`   — ISO timestamp the message was sent.

---

## 3. Example Unity C# receiver

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using NativeWebSocket;

[Serializable]
public class Flashcard
{
    public string id;
    public string front;
    public string back;
}

[Serializable]
public class FlashcardMessage
{
    public string from;
    public string type;
    public string deckId;
    public string deckTitle;
    public int count;
    public Flashcard[] cards;
    public string sentAt;
}

public class TutorBridge : MonoBehaviour
{
    private WebSocket websocket;

    async void Start()
    {
        // Identify as the unity client so the server routes messages here.
        websocket = new WebSocket("ws://localhost:8765?client=unity");

        websocket.OnOpen += () => Debug.Log("[TutorBridge] Connected to app.");
        websocket.OnError += (e) => Debug.LogError("[TutorBridge] Error: " + e);
        websocket.OnClose += (e) => Debug.Log("[TutorBridge] Closed.");

        websocket.OnMessage += (bytes) =>
        {
            var json = System.Text.Encoding.UTF8.GetString(bytes);
            var msg = JsonUtility.FromJson<FlashcardMessage>(json);

            if (msg != null && msg.type == "flashcards")
            {
                Debug.Log($"[TutorBridge] Received deck '{msg.deckTitle}' with {msg.count} cards.");
                LoadDeck(msg);
            }
        };

        await websocket.Connect();
    }

    void Update()
    {
        #if !UNITY_WEBGL || UNITY_EDITOR
        websocket?.DispatchMessageQueue();
        #endif
    }

    void LoadDeck(FlashcardMessage msg)
    {
        // TODO: hand msg.cards to your gameplay (spawn cards, start a round, etc.)
        foreach (var card in msg.cards)
        {
            Debug.Log($"  Q: {card.front}  |  A: {card.back}");
        }
    }

    // Optional: send results back to the app. Anything you send is delivered
    // to the tutor UI's useUnityMessages() listener.
    public async void SendScore(string deckId, int correct, int total)
    {
        if (websocket == null || websocket.State != WebSocketState.Open) return;
        string json = JsonUtility.ToJson(new GameResult
        {
            type = "game_result",
            deckId = deckId,
            correct = correct,
            total = total
        });
        await websocket.SendText(json);
    }

    async void OnApplicationQuit()
    {
        if (websocket != null) await websocket.Close();
    }
}

[Serializable]
public class GameResult
{
    public string type;
    public string deckId;
    public int correct;
    public int total;
}
```

---

## 4. Notes

- The WebSocket server only runs while the **Electron desktop app** is open. If
  you run Unity standalone with the app closed, the connection will fail — that
  is expected. Add a retry/reconnect loop if you want the game to wait for the
  app.
- `JsonUtility` handles this message shape fine (flat objects + an array). If you
  later add nested/dictionary fields, switch to Newtonsoft `Json.NET`.
- To send data **from Unity back to the app**, just `SendText` a JSON string with
  a `type` field. It arrives in the React UI via `useUnityMessages()` from
  `src/lib/unity-bridge.ts`.
- The port (`8765`) is defined in `electron/main.js` as `WS_PORT`. Keep both in
  sync if you change it.
- Place your built Unity executable/files in this `game/` folder so the desktop
  build can bundle/launch it.
