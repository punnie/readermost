package api

import "testing"

func TestReadingPrefsValidate(t *testing.T) {
	valid := readingPrefs{FontFamily: "opendyslexic", TextSize: "large", Density: "compact"}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid prefs rejected: %v", err)
	}

	for name, prefs := range map[string]readingPrefs{
		"font":    {FontFamily: "comic-sans", TextSize: "large", Density: "compact"},
		"size":    {FontFamily: "serif", TextSize: "huge", Density: "compact"},
		"density": {FontFamily: "serif", TextSize: "large", Density: ""},
	} {
		if err := prefs.validate(); err == nil {
			t.Errorf("%s: invalid prefs %+v accepted", name, prefs)
		}
	}
}
