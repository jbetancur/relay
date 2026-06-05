package agent

import "testing"

func TestAssembleMessages_PrependsStableSystemAnchor(t *testing.T) {
	instr := "You are a helpful coding assistant."

	turn1 := assembleMessages(instr, []upstreamMessage{
		{Role: "user", Content: "hi"},
	})
	turn2 := assembleMessages(instr, []upstreamMessage{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
		{Role: "user", Content: "now do X"},
	})

	// Invariant: the system anchor is index 0 and byte-identical across turns.
	if turn1[0].Role != "system" || turn2[0].Role != "system" {
		t.Fatalf("expected system message at index 0; got %q / %q", turn1[0].Role, turn2[0].Role)
	}
	if turn1[0].Content != turn2[0].Content {
		t.Fatalf("system anchor drifted between turns: %v vs %v", turn1[0].Content, turn2[0].Content)
	}
	if turn1[0].Content != instr {
		t.Fatalf("system anchor content = %v, want %v", turn1[0].Content, instr)
	}
}

func TestAssembleMessages_NoInstructionsPassthrough(t *testing.T) {
	in := []upstreamMessage{{Role: "user", Content: "hi"}}
	out := assembleMessages("", in)
	if len(out) != 1 || out[0].Role != "user" {
		t.Fatalf("expected passthrough with no system message; got %+v", out)
	}
}

func TestAssembleMessages_DoesNotDuplicateExistingSystem(t *testing.T) {
	in := []upstreamMessage{
		{Role: "system", Content: "caller-provided"},
		{Role: "user", Content: "hi"},
	}
	out := assembleMessages("agent instructions", in)
	if len(out) != 2 {
		t.Fatalf("expected no extra system message; got %d messages", len(out))
	}
	if out[0].Content != "caller-provided" {
		t.Fatalf("expected caller system preserved; got %v", out[0].Content)
	}
}
