package api

import "testing"

func TestReadingPrefsValidate(t *testing.T) {
	valid := readingPrefs{FontFamily: "opendyslexic", TextSize: "large", Density: "compact", Accent: "rose"}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid prefs rejected: %v", err)
	}

	for name, prefs := range map[string]readingPrefs{
		"font":    {FontFamily: "comic-sans", TextSize: "large", Density: "compact", Accent: "rose"},
		"size":    {FontFamily: "serif", TextSize: "huge", Density: "compact", Accent: "rose"},
		"density": {FontFamily: "serif", TextSize: "large", Density: "", Accent: "blue"},
		"accent":  {FontFamily: "serif", TextSize: "large", Density: "compact", Accent: "#ff00ff"},
	} {
		if err := prefs.validate(); err == nil {
			t.Errorf("%s: invalid prefs %+v accepted", name, prefs)
		}
	}
}
