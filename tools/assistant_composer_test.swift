import Foundation

@main struct AssistantComposerTests {
    static func main() throws {
        var state = AssistantComposerState()
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
        print("assistant composer: immutable retries, restart, stale completion, newer draft and payload bounds passed")
    }
}
