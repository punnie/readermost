package mattermost

// Attachment is a Mattermost message attachment: the card Mattermost draws
// under a post. Text and field values are rendered as markdown; the title,
// author name and footer are plain text.
type Attachment struct {
	Fallback   string            `json:"fallback"`
	Color      string            `json:"color,omitempty"`
	AuthorName string            `json:"author_name,omitempty"`
	AuthorLink string            `json:"author_link,omitempty"`
	Title      string            `json:"title,omitempty"`
	TitleLink  string            `json:"title_link,omitempty"`
	Text       string            `json:"text,omitempty"`
	Fields     []AttachmentField `json:"fields,omitempty"`
	ThumbURL   string            `json:"thumb_url,omitempty"`
	Footer     string            `json:"footer,omitempty"`
}

// AttachmentField is a titled value on a card. Short fields sit side by side.
type AttachmentField struct {
	Title string `json:"title"`
	Value string `json:"value"`
	Short bool   `json:"short"`
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
