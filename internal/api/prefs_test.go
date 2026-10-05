package api

import "testing"

func TestReadingPrefsValidate(t *testing.T) {
	valid := readingPrefs{FontFamily: "opendyslexic", TextSize: "large", Density: "compact", Accent: "rose", UnreadMark: "dot"}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid prefs rejected: %v", err)
	}

	for name, prefs := range map[string]readingPrefs{
		"font":    {FontFamily: "comic-sans", TextSize: "large", Density: "compact", Accent: "rose", UnreadMark: "dot"},
		"size":    {FontFamily: "serif", TextSize: "huge", Density: "compact", Accent: "rose", UnreadMark: "dot"},
		"density": {FontFamily: "serif", TextSize: "large", Density: "", Accent: "blue", UnreadMark: "count"},
		"accent":  {FontFamily: "serif", TextSize: "large", Density: "compact", Accent: "#ff00ff", UnreadMark: "count"},
		"unread":  {FontFamily: "serif", TextSize: "large", Density: "compact", Accent: "blue", UnreadMark: "hidden"},
	} {
		if err := prefs.validate(); err == nil {
			t.Errorf("%s: invalid prefs %+v accepted", name, prefs)
		}
	}
}
