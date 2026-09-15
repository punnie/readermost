package mattermost

import (
	"errors"
	"net/url"
)

// asError is errors.As specialised to *Error.
func asError(err error, target **Error) bool {
	return errors.As(err, target)
}

// asURLError is errors.As specialised to *url.Error.
func asURLError(err error, target **url.Error) bool {
	return errors.As(err, target)
}
