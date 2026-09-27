package mattermost

// Attachment is a Mattermost message attachment: the card Mattermost draws
// under a post. Text is rendered as markdown; the title, author name and footer
// are plain text.
type Attachment struct {
	Fallback   string `json:"fallback"`
	Color      string `json:"color,omitempty"`
	AuthorName string `json:"author_name,omitempty"`
	AuthorLink string `json:"author_link,omitempty"`
	Title      string `json:"title,omitempty"`
	TitleLink  string `json:"title_link,omitempty"`
	Text       string `json:"text,omitempty"`
	ThumbURL   string `json:"thumb_url,omitempty"`
	Footer     string `json:"footer,omitempty"`
}

// attachmentsKey is where Mattermost looks for attachments in a post's props.
const attachmentsKey = "attachments"

// SetAttachments puts cards on an outgoing post.
func (p *Post) SetAttachments(attachments ...Attachment) {
	if p.Props == nil {
		p.Props = map[string]any{}
	}
	p.Props[attachmentsKey] = attachments
}
