use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "items")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub container_id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub title: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub author: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub file_path: String,
    #[sea_orm(column_type = "Text")]
    pub format: String,
    pub size_bytes: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub content: Option<String>,
    #[sea_orm(column_type = "JsonBinary")]
    pub metadata: Json,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::containers::Entity",
        from = "Column::ContainerId",
        to = "super::containers::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Containers,
}

impl Related<super::containers::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Containers.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
