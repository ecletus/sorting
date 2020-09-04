package sorting

import (
	"fmt"
	"html/template"
	"net/http"
	"path"
	"strconv"

	"github.com/ecletus/admin"
	"github.com/ecletus/core"
	"github.com/ecletus/core/resource"
	"github.com/ecletus/roles"
)

func updatePosition(context *admin.Context) {
	if result, err := context.FindOne(); err == nil {
		if position, ok := result.(sortingInterface); ok {
			if pos, err := strconv.Atoi(context.Request.Form.Get("to")); err == nil {
				var count int
				if _, ok := result.(sortingDescInterface); ok {
					var result = context.Resource.NewStruct(context.Site)
					context.DB().Set("l10n:mode", "locale").Order("position DESC", true).First(result)
					count = result.(sortingInterface).GetPosition()
					pos = count - pos + 1
				}

				if MoveTo(context.DB(), position, pos) == nil {
					var pos = position.GetPosition()
					if _, ok := result.(sortingDescInterface); ok {
						pos = count - pos + 1
					}

					context.Writer.Write([]byte(fmt.Sprintf("%d", pos)))
					return
				}
			}
		}
	}
	context.Writer.WriteHeader(admin.HTTPUnprocessableEntity)
	context.Writer.Write([]byte("Error"))
}

// ConfigureResource configure sorting for qor admin
func (s *Sorting) ConfigureResource(res resource.Resourcer) {
	if res, ok := res.(*admin.Resource); ok {
		res.UseTheme("sorting")

		if res.Permission == nil {
			res.Permission = roles.NewPermission()
		}

		role := res.Permission.Role
		if _, ok := role.Get("sorting_mode"); !ok {
			role.Register(roles.NewDescriptor("sorting_mode", func(req *http.Request, currentUser interface{}) bool {
				return req.URL.Query().Get("sorting") != ""
			}))
		}

		if res.GetMeta("Position") == nil {
			res.Meta(&admin.Meta{
				Name: "Position",
				Valuer: func(value interface{}, ctx *core.Context) interface{} {
					db := ctx.DB()
					var count int
					var pos = value.(sortingInterface).GetPosition()

					if _, ok := modelValue(value).(sortingDescInterface); ok {
						if total, ok := db.Get("sorting_total_count"); ok {
							count = total.(int)
						} else {
							var result = res.NewStruct(ctx.Site)
							db.New().Order("position DESC", true).First(result)
							count = result.(sortingInterface).GetPosition()
							db.InstantSet("sorting_total_count", count)
						}
						pos = count - pos + 1
					}

					primaryKey := ctx.DB().NewScope(value).PrimaryKey()
					url := path.Join(ctx.Request.URL.Path, fmt.Sprintf("%v", primaryKey), "sorting/update_position")
					return template.HTML(fmt.Sprintf("<input type=\"number\" class=\"qor-sorting__position\" value=\"%v\" data-sorting-url=\"%v\" data-position=\"%v\">", pos, url, pos))
				},
				Permission: roles.Allow(roles.Read, "sorting_mode"),
			})
		}

		attrs := res.ConvertSectionToStrings(res.IndexAttrs())
		for _, attr := range attrs {
			if attr != "Position" {
				attrs = append(attrs, attr)
			}
		}
		res.IndexAttrs(res.IndexAttrs(), "Position")
		res.NewAttrs(res.NewAttrs(), "-Position")
		res.EditAttrs(res.EditAttrs(), "-Position")
		res.ShowAttrs(res.ShowAttrs(), "-Position", false)

		res.ItemRouter.Post("/sorting/update_position", updatePosition)
	}
}
