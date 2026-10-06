import Foundation

@main struct AssistantComposerTests {
    static func main() throws {
        var state = AssistantComposerState()
        let legacy = try JSONDecoder().decode(AssistantComposerState.self, from: Data(#"{"draft":"","pending":{"id":"legacy","text":"saved"}}"#.utf8))
        precondition(legacy.pending?.problem == nil, "Old saved drafts must still decode")
        for problem in AssistantPendingProblem.allCases {
            let saved = AssistantComposerState(draft: "", pending: .init(id: "saved", text: "hello", problem: problem))
            let loaded = try JSONDecoder().decode(AssistantComposerState.self, from: JSONEncoder().encode(saved))
            precondition(loaded == saved, "Problem notice must survive app restart")
            precondition(!problem.message(spanish: true).isEmpty && !problem.message(spanish: false).isEmpty)
        }
        precondition(state.begin() == nil)
        state.draft = "  Protege mis distracciones 45 minutos.  "
        let original = state.begin()!
        precondition(original.text == "Protege mis distracciones 45 minutos.")
        precondition(UUID(uuidString: original.id) != nil)
        precondition(state.draft.isEmpty)
        state.draft = "Después quiero revisar mis horarios."
        precondition(state.begin() == original, "Retry must not change text or id")
        let restored = try JSONDecoder().decode(AssistantComposerState.self, from: JSONEncoder().encode(state))
        precondition(restored == state, "App restart must preserve draft AND exact pending turn")
        state.complete("unrelated-turn")
        precondition(state.pending == original)
        state.complete(original.id)
        precondition(state.pending == nil)
        precondition(state.draft == "Después quiero revisar mis horarios.", "Reply must not erase newer writing")
        let second = state.begin()!
        precondition(second.id != original.id)
        state.complete(second.id)
        state.draft = String(repeating: "a", count: 4001)
        precondition(state.begin() == nil)
        state.draft = String(repeating: "🧠", count: 2001)
        precondition(state.begin() == nil, "Server length is UTF-16")
        state.draft = String(repeating: "a", count: 4000)
        precondition(state.begin() != nil)
        var audio = AssistantComposerState()
        audio.draft = "Borrador escrito aparte"
        let voice = audio.begin(audioText: "  Bloquea 20 minutos.  ")!
        precondition(voice.text == "Bloquea 20 minutos.")
        precondition(audio.draft == "Borrador escrito aparte", "Voice must never enter the text field")
        precondition(audio.begin(audioText: "Nuevo audio") == voice, "Voice retry keeps the original id and payload")
        audio.complete(voice.id)
        precondition(audio.draft == "Borrador escrito aparte")
        precondition(audio.begin(audioText: " ") == nil)
        precondition(audio.begin(audioText: String(repeating: "a", count: 4001)) == nil)
        print("assistant composer: immutable retries, restart, stale completion, newer draft and payload bounds passed")
    }
}
