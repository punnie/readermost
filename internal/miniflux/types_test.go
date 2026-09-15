package miniflux

import (
	"encoding/json"
	"testing"
)

func TestFeedHasIcon(t *testing.T) {
	tests := []struct {
		name string
		// The icon object exactly as Miniflux serialises it.
		payload string
		want    bool
	}{
		{
			name:    "a fetched feed with a favicon",
			payload: `{"icon":{"feed_id":74,"icon_id":3,"external_icon_id":"ba38db"}}`,
			want:    true,
		},
		{
			name: "a feed Miniflux has not fetched yet",
			// This is the shape that caused every imported feed to render a
			// broken image: present, but with no icon behind it.
			payload: `{"icon":{"feed_id":75,"icon_id":0,"external_icon_id":""}}`,
			want:    false,
		},
		{
			name:    "no icon field at all",
			payload: `{}`,
			want:    false,
		},
		{
			name:    "an explicitly null icon",
			payload: `{"icon":null}`,
			want:    false,
		},
	}

	for _, test := range tests {
		var feed Feed
		if err := json.Unmarshal([]byte(test.payload), &feed); err != nil {
			t.Fatalf("%s: unmarshal: %v", test.name, err)
		}
		if got := feed.HasIcon(); got != test.want {
			t.Errorf("%s: HasIcon() = %t, want %t", test.name, got, test.want)
		}
	}

	var nilFeed *Feed
	if nilFeed.HasIcon() {
		t.Error("HasIcon() on a nil feed should be false, not panic")
	}
}
