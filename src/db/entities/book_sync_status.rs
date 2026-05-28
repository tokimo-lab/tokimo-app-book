use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "book_sync_status")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub container_id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub status: String,
    pub last_sync_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_type = "Text", nullable)]
    pub last_error: Option<String>,
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub progress: Option<Json>,
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
